export function GlobeLoading() {
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#030014]" aria-busy="true">
      <div className="text-center">
        <div className="orbital-loader" />
        <p className="mt-4 text-[10px] font-semibold tracking-[0.32em] text-cyan-100/60">
          INITIALIZING THREE.JS
        </p>
      </div>
    </div>
  );
}
