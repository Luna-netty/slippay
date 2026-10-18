<?php
/**
 * Plugin Name:       SlipPay for WooCommerce
 * Plugin URI:        https://api.slippay.cc/
 * Description:       Accept USDC and PYUSD payments on Stellar with instant 6-second settlement, no chargebacks, non-custodial. Buyers pay in BRL via Pix, merchants receive stablecoins directly.
 * Version:           0.2.0
 * Author:            Bluewave AI
 * Author URI:        https://api.slippay.cc/
 * License:           Apache-2.0
 * License URI:       https://www.apache.org/licenses/LICENSE-2.0
 * Text Domain:       woocommerce-slippay
 * Requires PHP:      7.4
 * Requires at least: 6.0
 * WC requires at least: 7.0
 * WC tested up to:   9.0
 *
 * @package WooCommerce_Slippay
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( 'WC_SLIPPAY_VERSION', '0.2.0' );
define( 'WC_SLIPPAY_PLUGIN_FILE', __FILE__ );
define( 'WC_SLIPPAY_PLUGIN_DIR', plugin_dir_path( __FILE__ ) );

/**
 * Bootstrap: register the gateway only after WooCommerce loads.
 */
add_action( 'plugins_loaded', 'wc_slippay_init', 11 );
function wc_slippay_init() {
    if ( ! class_exists( 'WC_Payment_Gateway' ) ) {
        add_action( 'admin_notices', function () {
            echo '<div class="notice notice-error"><p>'
               . esc_html__( 'SlipPay for WooCommerce requires WooCommerce to be installed and active.', 'woocommerce-slippay' )
               . '</p></div>';
        } );
        return;
    }

    require_once WC_SLIPPAY_PLUGIN_DIR . 'includes/class-wc-slippay-gateway.php';
    require_once WC_SLIPPAY_PLUGIN_DIR . 'includes/class-wc-slippay-webhook.php';

    add_filter( 'woocommerce_payment_gateways', function ( $methods ) {
        $methods[] = 'WC_Slippay_Gateway';
        return $methods;
    } );

    // Webhook endpoint at /wc-api/wc_slippay
    new WC_Slippay_Webhook();
}

/**
 * Plugin action links: surface the settings page on the Plugins screen.
 */
add_filter( 'plugin_action_links_' . plugin_basename( __FILE__ ), function ( $links ) {
    $settings_url = admin_url( 'admin.php?page=wc-settings&tab=checkout&section=slippay' );
    array_unshift( $links, '<a href="' . esc_url( $settings_url ) . '">' . esc_html__( 'Settings', 'woocommerce-slippay' ) . '</a>' );
    return $links;
} );

/**
 * HPOS compatibility declaration (WooCommerce 8+ feature flag).
 */
add_action( 'before_woocommerce_init', function () {
    if ( class_exists( '\Automattic\WooCommerce\Utilities\FeaturesUtil' ) ) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility( 'custom_order_tables', WC_SLIPPAY_PLUGIN_FILE, true );
    }
} );

// Audit-006 W9: flush_rewrite_rules() removed — this plugin registers no
// rewrite rules; the webhook endpoint is a query-var (wc-api), not a permalink.
