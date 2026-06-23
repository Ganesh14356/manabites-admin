import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import RestaurantManagement from './pages/Admin/RestaurantManagement';
import DeliveryFeeSettings from './pages/Admin/DeliveryFeeSettings';
import MenuManagement from './pages/Admin/MenuManagement';
import CustomerManagement from './pages/Admin/CustomerManagement';
import OrderManagement from './pages/Admin/OrderManagement';
import Analytics from './pages/Admin/Analytics';
import Payouts from './pages/Admin/Payouts';
import PromoCodes from './pages/Admin/PromoCodes';
import Banners from './pages/Admin/Banners';
import FoodCategories from './pages/Admin/FoodCategories';
import RestaurantApproval from './pages/Admin/RestaurantApproval';
import RazorpayPayments from './pages/Admin/RazorpayPayments';
import RiderManagement from './pages/Admin/RiderManagement';
import RiderApproval from './pages/Admin/RiderApproval';
import LiveOrdersMap from './pages/Admin/LiveOrdersMap';
import LiveRidersMap from './pages/Admin/LiveRidersMap';
import RiderPerformance from './pages/Admin/RiderPerformance';
import Geofencing from './pages/Admin/Geofencing';
import NotificationsBroadcast from './pages/Admin/NotificationsBroadcast';
import RefundManagement from './pages/Admin/RefundManagement';
import ReviewsManagement from './pages/Admin/ReviewsManagement';
import RatingAppeals from './pages/Admin/RatingAppeals';
import SOSAlerts from './pages/Admin/SOSAlerts';
import DailySettlements from './pages/Admin/DailySettlements';
import CashfreeSettlements from './pages/Admin/CashfreeSettlements';
import Commission from './pages/Admin/Commission';
import SurgePricing from './pages/Admin/SurgePricing';
import WalletSubscription from './pages/Admin/WalletSubscription';
import SubAdminManagement from './pages/Admin/SubAdminManagement';
import GeoMarketing from './pages/Admin/GeoMarketing';
import WhatsAppAutomation from './pages/Admin/WhatsAppAutomation';
import FraudDetection from './pages/Admin/FraudDetection';
import Blacklist from './pages/Admin/Blacklist';
import RiderIncentives from './pages/Admin/RiderIncentives';
import CampaignManager from './pages/Admin/CampaignManager';
import ReferralDashboard from './pages/Admin/ReferralDashboard';
import VerticalsHub from './pages/Admin/VerticalsHub';
import CityManager from './pages/Admin/CityManager';
import FranchiseManager from './pages/Admin/FranchiseManager';
import AIInsights from './pages/Admin/AIInsights';
import Complaints from './pages/Admin/Complaints';
import CustomerCare from './pages/Admin/CustomerCare';
import SupportChats from './pages/Admin/SupportChats';
import DirectChat from './pages/Admin/DirectChat';
import ManaBitesSupport from './pages/Admin/ManaBitesSupport';
import Expenses from './pages/Admin/Expenses';
import Fines from './pages/Admin/Fines';
import ActivityLogs from './pages/Admin/ActivityLogs';
import GroceryStores from './pages/Admin/GroceryStores';
import GroceryProducts from './pages/Admin/GroceryProducts';
import GroceryOrders from './pages/Admin/GroceryOrders';

export default function App() {
  return (
    <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: '12px',
              fontWeight: 600,
              fontSize: '14px',
            },
          }}
        />
        <div className="min-h-screen bg-gray-50 font-sans text-gray-900">
          <Routes>
            {/* Public: Login */}
            <Route path="/login" element={<Login />} />

            {/* Redirect root → analytics (ProtectedRoute will bounce to /login if needed) */}
            <Route path="/" element={<Navigate to="/admin/analytics" replace />} />

            {/* Protected Admin Routes */}
            <Route element={<ProtectedRoute />}>
              <Route path="/admin" element={<AdminLayout />}>
                <Route path="analytics" element={<Analytics />} />
                <Route path="orders" element={<OrderManagement />} />
                <Route path="restaurants" element={<RestaurantManagement />} />
                <Route path="restaurants/:restaurantId/menu" element={<MenuManagement />} />
                <Route path="customers" element={<CustomerManagement />} />
                <Route path="payouts" element={<Payouts />} />
                <Route path="promocodes" element={<PromoCodes />} />
                <Route path="banners" element={<Banners />} />
                <Route path="food-categories" element={<FoodCategories />} />
                <Route path="restaurants-approval" element={<RestaurantApproval />} />
                <Route path="razorpay" element={<RazorpayPayments />} />
                <Route path="settings" element={<DeliveryFeeSettings />} />
                <Route path="riders" element={<RiderManagement />} />
                <Route path="rider-approvals" element={<RiderApproval />} />
                <Route path="live-map" element={<LiveOrdersMap />} />
                <Route path="rider-map" element={<LiveRidersMap />} />
                <Route path="rider-performance" element={<RiderPerformance />} />
                <Route path="geofencing" element={<Geofencing />} />
                <Route path="notifications" element={<NotificationsBroadcast />} />
                <Route path="refunds" element={<RefundManagement />} />
                <Route path="reviews" element={<ReviewsManagement />} />
                <Route path="rating-appeals" element={<RatingAppeals />} />
                <Route path="sos-alerts" element={<SOSAlerts />} />
                <Route path="settlements" element={<DailySettlements />} />
                <Route path="cashfree-settlements" element={<CashfreeSettlements />} />
                <Route path="commission" element={<Commission />} />
                <Route path="surge-pricing" element={<SurgePricing />} />
                <Route path="wallet" element={<WalletSubscription />} />
                <Route path="sub-admins" element={<SubAdminManagement />} />
                <Route path="activity-logs" element={<ActivityLogs />} />
                <Route path="geo-marketing" element={<GeoMarketing />} />
                <Route path="whatsapp" element={<WhatsAppAutomation />} />
                <Route path="rider-incentives" element={<RiderIncentives />} />
                <Route path="campaigns" element={<CampaignManager />} />
                <Route path="referrals" element={<ReferralDashboard />} />
                <Route path="fraud" element={<FraudDetection />} />
                <Route path="blacklist" element={<Blacklist />} />
                <Route path="verticals" element={<VerticalsHub />} />
                <Route path="cities" element={<CityManager />} />
                <Route path="franchises" element={<FranchiseManager />} />
                <Route path="ai-insights" element={<AIInsights />} />
                <Route path="complaints" element={<Complaints />} />
                <Route path="customer-care" element={<CustomerCare />} />
                <Route path="support-chats" element={<SupportChats />} />
                <Route path="direct-chat" element={<DirectChat />} />
                <Route path="support" element={<ManaBitesSupport />} />
                <Route path="expenses" element={<Expenses />} />
                <Route path="fines" element={<Fines />} />
                <Route path="grocery-stores"   element={<GroceryStores />} />
                <Route path="grocery-products" element={<GroceryProducts />} />
                <Route path="grocery-orders"   element={<GroceryOrders />} />
                {/* Legacy alias */}
                <Route path="delivery-settings" element={<Navigate to="/admin/settings" replace />} />
              </Route>
            </Route>

            <Route
              path="/unauthorized"
              element={
                <div className="flex items-center justify-center min-h-screen bg-gray-50">
                  <div className="text-center">
                    <div className="text-6xl mb-4">🚫</div>
                    <h1 className="text-4xl font-black text-red-500 mb-2">403</h1>
                    <p className="text-gray-600 font-semibold">Unauthorized Access</p>
                    <a href="/login" className="mt-4 inline-block text-brand hover:underline font-semibold">
                      Back to Login
                    </a>
                  </div>
                </div>
              }
            />

            {/* 404 */}
            <Route
              path="*"
              element={<Navigate to="/admin/analytics" replace />}
            />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
    </ThemeProvider>
  );
}
