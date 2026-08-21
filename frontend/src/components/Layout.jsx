import { Outlet } from 'react-router-dom';
import Navbar from './Navbar';
import useRouteTracking from '../hooks/useRouteTracking';

export default function Layout() {
  // Every routed screen sits under this, so one call covers the whole app.
  useRouteTracking();
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-5 md:py-8 pb-24 md:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
