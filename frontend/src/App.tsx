import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Navbar from './components/layout/Navbar';
import LandingPage from './pages/LandingPage';
import DashboardPage from './pages/DashboardPage';
import MarketsPage from './pages/MarketsPage';
import PositionPage from './pages/PositionPage';
import LiquidatePage from './pages/LiquidatePage';
import AdminPage from './pages/AdminPage';
import GovernancePage from './pages/GovernancePage';
import SwapPage from './pages/SwapPage';

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-1 animate-fade-in">
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/position" element={<PositionPage />} />
            <Route path="/governance" element={<GovernancePage />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/liquidate" element={<LiquidatePage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
