import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import SiteFooter from './components/layout/SiteFooter';
import WrongNetworkBanner from './components/layout/WrongNetworkBanner';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import MarketsPage from './pages/MarketsPage';
import PositionPage from './pages/PositionPage';
import LiquidatePage from './pages/LiquidatePage';
import AdminPage from './pages/AdminPage';
import GovernancePage from './pages/GovernancePage';
import RewardsPage from './pages/RewardsPage';
import SwapPage from './pages/SwapPage';
import SecurityPage from './pages/SecurityPage';
import LightpaperPage from './pages/LightpaperPage';

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <div className="min-h-screen flex flex-col overflow-x-hidden">
        <Navbar />
        <WrongNetworkBanner />
        <main className="flex-1 animate-fade-in">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/position" element={<PositionPage />} />
            <Route path="/governance" element={<GovernancePage />} />
            <Route path="/rewards" element={<RewardsPage />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/liquidate" element={<LiquidatePage />} />
            <Route path="/security" element={<SecurityPage />} />
            <Route path="/lightpaper" element={<LightpaperPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
        <SiteFooter />
      </div>
    </BrowserRouter>
  );
}
