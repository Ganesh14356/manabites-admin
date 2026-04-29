import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import AdminLayout from './components/AdminLayout';
import Login from './pages/Login';
import RestaurantManagement from './pages/Admin/RestaurantManagement';
import DeliveryFeeSettings from './pages/Admin/DeliveryFeeSettings';
import MenuManagement from './pages/Admin/MenuManagement';
import RiderManagement from './pages/Admin/RiderManagement';
import CustomerManagement from './pages/Admin/CustomerManagement';
import OrderManagement from './pages/Admin/OrderManagement';
import Analytics from './pages/Admin/Analytics';
import Payouts from './pages/Admin/Payouts';
import PromoCodes from './pages/Admin/PromoCodes';
import Banners from './pages/Admin/Banners';
import RestaurantApproval from './pages/Admin/RestaurantApproval';
import RiderApproval from './pages/Admin/RiderApproval';
import RazorpayPayments from './pages/Admin/RazorpayPayments';

export default function App() {
  return (
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
                <Route path="riders" element={<RiderManagement />} />
                <Route path="customers" element={<CustomerManagement />} />
                <Route path="payouts" element={<Payouts />} />
                <Route path="promocodes" element={<PromoCodes />} />
                <Route path="banners" element={<Banners />} />
                <Route path="restaurants-approval" element={<RestaurantApproval />} />
                <Route path="riders-approval" element={<RiderApproval />} />
                <Route path="razorpay" element={<RazorpayPayments />} />
                <Route path="settings" element={<DeliveryFeeSettings />} />
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
  );
}
