export default function Loading() {
  return (
    <main className="app-shell grid min-h-screen place-items-center" aria-busy="true">
      <div className="text-center">
        <div className="orbital-loader" />
        <p className="mt-5 text-xs font-semibold tracking-[0.35em] text-cyan-100/70">ACQUIRING ORBIT</p>
      </div>
    </main>
  );
}
