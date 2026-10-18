import { Routes, Route } from "react-router-dom";
import AgentHome from "./pages/AgentHome.tsx";
import LandingV2 from "./pages/LandingV2.tsx";
import LandingV3 from "./pages/LandingV3.tsx";
import Builders from "./pages/Builders.tsx";
import Verify from "./pages/Verify.tsx";
import Home from "./pages/Home.tsx";
import Agents from "./pages/Agents.tsx";
import Comprovante from "./pages/Comprovante.tsx";
import Checkout from "./pages/Checkout.tsx";
import Sub from "./pages/Sub.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import Dashboard from "./pages/Dashboard.tsx";
import DashboardOverview from "./pages/DashboardOverview.tsx";
import DashboardOrders from "./pages/DashboardOrders.tsx";
import DashboardSubscriptions from "./pages/DashboardSubscriptions.tsx";
import DashboardSettings from "./pages/DashboardSettings.tsx";
import Demo from "./pages/Demo.tsx";
import Preview from "./pages/Preview.tsx";
import X402Demo from "./pages/X402Demo.tsx";
import AnchorDemo from "./pages/AnchorDemo.tsx";
import WithdrawDemo from "./pages/WithdrawDemo.tsx";
import BioTest from "./pages/BioTest.tsx";
import PayDemo from "./pages/PayDemo.tsx";
import Cobrar from "./pages/Cobrar.tsx";
import Account from "./pages/Account.tsx";
import Cash from "./pages/Cash.tsx";
import Gate from "./pages/Gate.tsx";
import Store from "./pages/Store.tsx";
import PolicySubscribe from "./pages/PolicySubscribe.tsx";
import Docs from "./pages/Docs.tsx";
import Security from "./pages/Security.tsx";
import Manifesto from "./pages/Manifesto.tsx";
import Investors from "./pages/Investors.tsx";
import Conformidade from "./pages/Conformidade.tsx";
import PixPay from "./pages/PixPay.tsx";
import Vault from "./pages/Vault.tsx";
import ZkRedirect from "./pages/ZkRedirect.tsx";
import Receber from "./pages/Receber.tsx";
import Empresas from "./pages/Empresas.tsx";


import ComexBase from "./pages/ComexBase.tsx";
import { ComexBaseProvider } from "./lib/comexBase.tsx";
import BusinessLanding from "./pages/comex/BusinessLanding";
import { PaymentRoute } from "./components/PaymentRoute.tsx";
export default function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingV2 />} />
      <Route path="/v3" element={<LandingV3 />} />
      <Route path="/zk" element={<ZkRedirect />} />
      <Route path="/cofrinho-landing" element={<LandingV2 />} />
      <Route path="/receber" element={<PaymentRoute><Receber /></PaymentRoute>} />
      {import.meta.env.VITE_PAGFINANCE_ENABLED === "1" && <Route path="/pix-pay" element={<PaymentRoute><PixPay /></PaymentRoute>} />}
      {import.meta.env.VITE_COMEX_ENABLED === "1" && (
        <Route path="/comex" element={
          <PaymentRoute>
            {import.meta.env.VITE_PRIVY_APP_ID
              ? <ComexBaseProvider><ComexBase /></ComexBaseProvider>
              : <BusinessLanding />}
          </PaymentRoute>
        } />
      )}
      {import.meta.env.VITE_DEFINDEX_ENABLED === "1" && <Route path="/cofre" element={<PaymentRoute><Vault /></PaymentRoute>} />}
      <Route path="/empresas" element={<Empresas />} />
      <Route path="/b2b" element={<Empresas />} />
      <Route path="/v1" element={<AgentHome />} />
      <Route path="/builders" element={<Builders />} />
      <Route path="/v2" element={<LandingV2 />} />
      <Route path="/human" element={<Home />} />
      <Route path="/verify" element={<Verify />} />
      <Route path="/agents" element={<Agents />} />
      <Route path="/comprovante/:txhash" element={<PaymentRoute><Comprovante /></PaymentRoute>} />
      <Route path="/login" element={<Login />} />
      <Route path="/signup" element={<Signup />} />
      <Route path="/checkout/:order_id" element={<PaymentRoute><Checkout /></PaymentRoute>} />
      <Route path="/sub/:id" element={<PaymentRoute><Sub /></PaymentRoute>} />
      <Route path="/demo" element={<Demo />} />
      <Route path="/preview" element={<Preview />} />
      <Route path="/x402-demo" element={<X402Demo />} />
      <Route path="/anchor-demo" element={<AnchorDemo />} />
      <Route path="/withdraw-demo" element={<WithdrawDemo />} />
      <Route path="/bio" element={<BioTest />} />
      <Route path="/pay" element={<PayDemo />} />
      <Route path="/cobrar" element={<PaymentRoute><Cobrar /></PaymentRoute>} />
      <Route path="/account" element={<Account />} />
      <Route path="/buy" element={<PaymentRoute><Cash /></PaymentRoute>} />
      <Route path="/comprar" element={<PaymentRoute><Cash /></PaymentRoute>} />
      <Route path="/cash" element={<PaymentRoute><Cash /></PaymentRoute>} />
      <Route path="/pix" element={<PaymentRoute><Cash /></PaymentRoute>} />
      <Route path="/gate" element={<PaymentRoute><Gate /></PaymentRoute>} />
      <Route path="/loja" element={<Store />} />
      <Route path="/s/:subId" element={<PaymentRoute><PolicySubscribe /></PaymentRoute>} />
      <Route path="/docs" element={<Docs />} />
      <Route path="/docs/*" element={<Docs />} />
      <Route path="/seguranca" element={<Security />} />
      <Route path="/security" element={<Security />} />
      <Route path="/manifesto" element={<Manifesto />} />
      <Route path="/investors" element={<Investors />} />
      <Route path="/investidores" element={<Investors />} />
      <Route path="/pitch" element={<Investors />} />
      <Route path="/conformidade" element={<Conformidade />} />
      <Route path="/compliance" element={<Conformidade />} />
      <Route path="/dashboard" element={<Dashboard />}>
        <Route index element={<DashboardOverview />} />
        <Route path="orders" element={<DashboardOrders />} />
        <Route path="subscriptions" element={<DashboardSubscriptions />} />
        <Route path="settings" element={<DashboardSettings />} />
      </Route>
      <Route path="*" element={<div className="p-8">not found</div>} />
    </Routes>
  );
}
