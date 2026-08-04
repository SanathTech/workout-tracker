import { useNavigate } from 'react-router-dom';

// Back that returns where you actually came from. React Router stamps an index into
// history.state; at 0 this tab has no in-app history (deep link, PWA cold start), so
// going -1 would leave the app — fall back to a sensible screen instead.
export function useSmartBack(fallback = '/dashboard') {
  const navigate = useNavigate();
  return () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(fallback, { replace: true });
  };
}
