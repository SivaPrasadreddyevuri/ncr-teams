import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { NavProvider } from '@/components/nav/NavProvider';
import { ShellTitleProvider } from '@/components/nav/ShellTitle';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import { RouteGate } from '@/components/RouteGate';
import { WorkspaceProvider } from '@/components/workspace/WorkspaceProvider';

/**
 * The authenticated shell.
 *
 * UI-only prototype: there is no session, so the signed-in person comes from the
 * workspace store, which is seeded from the mock dataset and restored from
 * storage on mount. The shell lives in a layout rather than in each page so a
 * route's `loading.tsx` renders *inside* the sidebar and topbar instead of
 * replacing the whole viewport.
 *
 * Provider order matters. `WorkspaceProvider` owns the session and the shared
 * records, and `ProfileProvider` reads the active person from it to know whose
 * edits to apply, so workspace has to sit above.
 *
 * `RouteGate` wraps the content only, never the chrome: the sidebar and topbar
 * stay put while a page is "loading", which is the behaviour the route
 * `loading.tsx` files were always written for.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellTitleProvider>
      <WorkspaceProvider>
        <ProfileProvider>
          <NavProvider>
            <div className="app-shell">
              <Sidebar />
              <main className="main">
                <Topbar />
                <section className="content">
                  <RouteGate>{children}</RouteGate>
                </section>
              </main>
            </div>
          </NavProvider>
        </ProfileProvider>
      </WorkspaceProvider>
    </ShellTitleProvider>
  );
}
