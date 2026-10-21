<?php
/**
 * SlipPay webhook receiver.
 * Listens at /wc-api/wc_slippay (registered automatically by WC's API
 * dispatcher when the woocommerce_api_<id> action fires). Verifies HMAC
 * if a webhook_secret is configured, then marks the matching WC order
 * as paid (or underpaid / cancelled / expired).
 *
 * @package WooCommerce_Slippay
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

class WC_Slippay_Webhook {

    public function __construct() {
        add_action( 'woocommerce_api_wc_slippay', [ $this, 'handle' ] );
    }

    public function handle() {
        $raw = file_get_contents( 'php://input' );
        if ( ! $raw ) {
            status_header( 400 );
            echo wp_json_encode( [ 'error' => 'empty body' ] );
            exit;
        }

        $gateway = $this->get_gateway();
        $secret  = $gateway ? (string) $gateway->get_option( 'webhook_secret' ) : '';

        // Webhook secret is mandatory. Empty config is treated as misconfiguration,
        // not as "skip verification" — closing the auth-bypass vector from audit-001.
        if ( strlen( $secret ) < 32 ) {
            status_header( 503 );
            echo wp_json_encode( [ 'error' => 'webhook_not_configured' ] );
            exit;
        }

        $sig = $this->get_signature_header();
        if ( empty( $sig ) ) {
            status_header( 401 );
            echo wp_json_encode( [ 'error' => 'missing signature header' ] );
            exit;
        }

        // Listener emits "t=<unix>,v1=<hex>" over HMAC-SHA256(secret, "<t>.<body>").
        // Reference: apps/listener/src/crypto.ts:3-13.
        if ( ! preg_match( '/^t=(\d+),v1=([a-f0-9]{64})$/', $sig, $m ) ) {
            status_header( 401 );
            echo wp_json_encode( [ 'error' => 'malformed signature' ] );
            exit;
        }
        $t  = (int) $m[1];
        $v1 = $m[2];

        if ( abs( time() - $t ) > 300 ) {
            status_header( 401 );
            echo wp_json_encode( [ 'error' => 'stale signature' ] );
            exit;
        }

        $expected = hash_hmac( 'sha256', $t . '.' . $raw, $secret );
        if ( ! hash_equals( $expected, $v1 ) ) {
            status_header( 401 );
            echo wp_json_encode( [ 'error' => 'invalid signature' ] );
            exit;
        }

        // Replay protection. Listener sends a per-delivery uuid in x-slippay-delivery-id
        // (apps/listener/src/webhook.ts:35). Reject duplicates within a 24h window.
        $delivery_id = isset( $_SERVER['HTTP_X_SLIPPAY_DELIVERY_ID'] )
            ? sanitize_text_field( $_SERVER['HTTP_X_SLIPPAY_DELIVERY_ID'] )
            : '';
        if ( $delivery_id !== '' ) {
            $seen_key = 'slippay_seen_' . md5( $delivery_id );
            if ( get_transient( $seen_key ) ) {
                status_header( 409 );
                echo wp_json_encode( [ 'error' => 'duplicate delivery' ] );
                exit;
            }
            set_transient( $seen_key, 1, DAY_IN_SECONDS );
        }

        $payload = json_decode( $raw, true );
        if ( ! is_array( $payload ) || empty( $payload['type'] ) || empty( $payload['data']['id'] ) ) {
            status_header( 400 );
            echo wp_json_encode( [ 'error' => 'malformed payload' ] );
            exit;
        }

        $slippay_order_id = sanitize_text_field( $payload['data']['id'] );
        $type             = sanitize_key( $payload['type'] );
        $tx_hash          = isset( $payload['data']['tx_hash'] ) ? sanitize_text_field( $payload['data']['tx_hash'] ) : '';

        $wc_order = $this->find_order_by_slippay_id( $slippay_order_id );
        if ( ! $wc_order ) {
            status_header( 404 );
            echo wp_json_encode( [ 'error' => 'wc order not found', 'slippay_id' => $slippay_order_id ] );
            exit;
        }

        // Audit-006 W3: every value interpolated into add_order_note /
        // update_status notes is wrapped in esc_html. WC renders notes as
        // HTML in admin; a compromised api_base / payload field could
        // inject markup otherwise.
        switch ( $type ) {
            case 'order.paid':
            case 'subscription.charged':
                if ( $tx_hash ) {
                    $wc_order->update_meta_data( '_slippay_tx_hash', $tx_hash );
                }
                $wc_order->payment_complete( $tx_hash );
                $wc_order->add_order_note( sprintf(
                    'SlipPay %s confirmed. tx: %s',
                    esc_html( $type ),
                    esc_html( $tx_hash ?: 'n/a' )
                ) );
                break;

            case 'order.underpaid':
                $expected = isset( $payload['data']['expected'] ) ? (string) $payload['data']['expected'] : '?';
                $received = isset( $payload['data']['received'] ) ? (string) $payload['data']['received'] : '?';
                $wc_order->update_status( 'on-hold', sprintf(
                    'SlipPay underpayment. expected %s, received %s',
                    esc_html( $expected ),
                    esc_html( $received )
                ) );
                break;

            case 'order.expired':
                $wc_order->update_status( 'cancelled', 'SlipPay order expired before payment.' );
                break;

            case 'order.cancelled':
                $wc_order->update_status( 'cancelled', 'SlipPay order cancelled.' );
                break;

            default:
                $wc_order->add_order_note( 'SlipPay event received (no-op for this type): ' . esc_html( $type ) );
                break;
        }

        $wc_order->save();
        status_header( 200 );
        echo wp_json_encode( [ 'ok' => true ] );
        exit;
    }

    private function get_signature_header() {
        // SlipPay convention: X-Slippay-Signature
        if ( isset( $_SERVER['HTTP_X_SLIPPAY_SIGNATURE'] ) ) {
            return sanitize_text_field( $_SERVER['HTTP_X_SLIPPAY_SIGNATURE'] );
        }
        if ( isset( $_SERVER['HTTP_X_SIGNATURE'] ) ) {
            return sanitize_text_field( $_SERVER['HTTP_X_SIGNATURE'] );
        }
        return '';
    }

    private function find_order_by_slippay_id( $slippay_order_id ) {
        $orders = wc_get_orders( [
            'limit'      => 1,
            'meta_key'   => '_slippay_order_id',
            'meta_value' => $slippay_order_id,
        ] );
        // Numeric-id fallback removed (audit-001): it converted the metadata-bound
        // lookup into a guessable integer probe of WC orders. Require the
        // _slippay_order_id meta to be set by the gateway at order creation time.
        return empty( $orders ) ? null : $orders[0];
    }

    private function get_gateway() {
        $gateways = WC()->payment_gateways()->payment_gateways();
        return isset( $gateways['slippay'] ) ? $gateways['slippay'] : null;
    }
}
