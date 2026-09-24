import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface LoadingStateProps {
  title?: string | undefined;
  description?: string | undefined;
  className?: string | undefined;
  compact?: boolean;
}

export function LoadingState({
  title = "Carregando",
  description,
  className,
  compact = false,
}: LoadingStateProps) {
  return (
    <div
      className={cn("nodus-loading", compact && "nodus-loading--compact", className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="nodus-loading__mark" aria-hidden="true">
        <Loader2 className="size-5 animate-spin" />
      </span>
      <div>
        <p className="nodus-loading__title">{title}</p>
        {description ? <p className="nodus-loading__description">{description}</p> : null}
      </div>
    </div>
  );
}

export function PageLoading({ title, description }: Omit<LoadingStateProps, "compact">) {
  return (
    <main className="nodus-page-loading">
      <LoadingState title={title} description={description} />
    </main>
  );
}
