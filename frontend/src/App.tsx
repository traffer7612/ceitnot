import { useState } from "react";
import { useAccount } from "wagmi";
import { Header } from "./components/Header";
import { Hero } from "./components/Hero";
import { Stats } from "./components/Stats";
import { Dashboard } from "./components/Dashboard";
import { Footer } from "./components/Footer";

function App() {
  const { isConnected } = useAccount();
  const [activeTab, setActiveTab] = useState<"deposit" | "borrow" | "repay">("deposit");

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1">
        <Hero />
        <Stats />
        {isConnected ? (
          <Dashboard activeTab={activeTab} onTabChange={setActiveTab} />
        ) : (
          <section className="max-w-2xl mx-auto px-4 py-16 text-center">
            <p className="text-aura-muted text-lg">
              Connect your wallet to manage your position, deposit collateral, and borrow.
            </p>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}

export default App;
