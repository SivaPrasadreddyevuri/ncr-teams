import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { NavProvider } from '@/components/nav/NavProvider';
import { ShellTitleProvider } from '@/components/nav/ShellTitle';
import { ProfileProvider } from '@/components/profile/ProfileProvider';
import { currentUser } from '@/lib/data';

/**
 * The authenticated shell.
 *
 * UI-only prototype: there is no session, so the signed-in person comes straight
 * from the mock dataset. The shell lives in a layout rather than in each page
 * so a route's `loading.tsx` renders *inside* the sidebar and topbar instead of
 * replacing the whole viewport.
 *
 * `ProfileProvider` sits above the shell so the sidebar, the topbar and the
 * settings form all read one profile. Without it each screen imported
 * `currentUser` directly and a photo or name edited in Settings could never
 * reach the rest of the app.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ShellTitleProvider>
      <ProfileProvider>
        <NavProvider>
          <div className="app-shell">
            <Sidebar user={currentUser} />
            <main className="main">
              <Topbar user={currentUser} />
              <section className="content">{children}</section>
            </main>
          </div>
        </NavProvider>
      </ProfileProvider>
    </ShellTitleProvider>
  );
}
