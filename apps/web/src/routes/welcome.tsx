import { createFileRoute, redirect, useLocation, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { NoProjectsHero } from "../components/NoProjectsHero";
import { WelcomeWizard } from "../components/onboarding/WelcomeWizard";
import { useCreateNativeSession } from "../components/neopi/NativeSessionSidebar";
import { readProjects } from "../state/entities";

/** Onboarding overlays the workspace. Visiting /welcome reopens setup. */
export const Route = createFileRoute("/welcome")({
  beforeLoad: ({ context }) => {
    const { authGateState } = context;
    if (authGateState.status !== "authenticated" && authGateState.status !== "hosted-static") {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: WelcomeRouteView,
});

function WelcomeRouteView() {
  const { authGateState } = Route.useRouteContext();
  const navigate = useNavigate();
  // The root shell can remount this pending outlet after the location changes.
  // Never reopen setup while the destination route is still loading.
  const isWelcomeRoute = useLocation({ select: (location) => location.pathname === "/welcome" });
  const [dismissed, setDismissed] = useState(false);
  const createSession = useCreateNativeSession();
  // An authenticated gate means a primary server is serving this app —
  // desktop, `npx t3`, or a dev server — and that server is "this machine"
  // no matter what hostname the browser used. Only hosted-static has no
  // local server to offer.
  const localAvailable = authGateState.status === "authenticated";
  return (
    <>
      <NoProjectsHero />
      {isWelcomeRoute && !dismissed ? (
        <WelcomeWizard
          localAvailable={localAvailable}
          onDone={(projectRef) => {
            setDismissed(true);
            if (projectRef !== undefined) {
              const cwd = readProjects().find(
                (project) =>
                  project.environmentId === projectRef.environmentId &&
                  project.id === projectRef.projectId,
              )?.workspaceRoot;
              void createSession(projectRef.environmentId, cwd).catch(() => {
                void navigate({ to: "/", replace: true });
              });
              return;
            }
            void navigate({ to: "/", replace: true });
          }}
        />
      ) : null}
    </>
  );
}
