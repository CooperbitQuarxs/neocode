// @vitest-environment jsdom

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { act, StrictMode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { MainAppLocationTracker, useNavigateToMainApp } from "./mainAppLocation";

let renderer: ReactTestRenderer | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  vi.unstubAllGlobals();
});

function AppShell() {
  const navigateToMainApp = useNavigateToMainApp();
  return (
    <>
      <MainAppLocationTracker />
      <button onClick={navigateToMainApp}>Back</button>
    </>
  );
}

it("returns from setup settings to the workspace, preserving a previously visited conversation", async () => {
  const rootRoute = createRootRoute({ component: AppShell });
  const router = createRouter({
    routeTree: rootRoute.addChildren([createRoute({ getParentRoute: () => rootRoute, path: "$" })]),
    history: createMemoryHistory({ initialEntries: ["/welcome?step=neopi#setup"] }),
  });
  await router.load();
  await act(() => {
    renderer = create(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    );
  });

  const open = async (href: string) => {
    await act(async () => {
      await router.navigate({ href });
    });
  };
  const back = async () => {
    await act(async () => {
      await renderer!.root.findByType("button").props.onClick();
    });
  };

  await open("/settings/neocore?machine=office&instanceId=office-neopi");
  await back();
  expect(router.state.location.href).toBe("/");

  const conversationHref = "/threads/conversation-42?machine=office&focus=latest#message-7";
  await open(conversationHref);
  await open("/welcome?step=neopi#setup");
  expect(router.state.location.href).toBe("/welcome?step=neopi#setup");
  await open("/settings/neocore?machine=office&instanceId=office-neopi");
  await open("/models");
  await back();
  expect(router.state.location.href).toBe(conversationHref);
});
