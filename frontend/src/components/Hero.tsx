export function Hero() {
  return (
    <section className="max-w-4xl mx-auto px-4 pt-16 pb-12 text-center">
      <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-4">
        <span className="text-white">Yield-Backed</span>
        <br />
        <span className="bg-gradient-to-r from-aura-gold to-aura-accent bg-clip-text text-transparent">
          Credit Engine
        </span>
      </h1>
      <p className="text-aura-muted text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
        Deposit yield-bearing assets as collateral. Borrow stablecoins. Your collateral’s yield
        automatically pays down your debt — self-liquidating positions.
      </p>
    </section>
  );
}
