import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/LoadingState";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  pendingComponent: () => (
    <PageLoading
      title="Preparando o Nódus"
      description="Validando seu acesso e carregando o ambiente."
    />
  ),
  component: () => <Outlet />,
});
