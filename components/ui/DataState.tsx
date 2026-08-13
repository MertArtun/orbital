export function DataState({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <div className="data-state" role="status">
      <div className="data-state__orbit" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-slate-100">{title}</p>
        <p className="mt-1 text-xs leading-5 text-slate-400">{message}</p>
      </div>
    </div>
  );
}
