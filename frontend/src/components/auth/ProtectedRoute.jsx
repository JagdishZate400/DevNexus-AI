import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { isMockToken } from '../../services/api'

function ProtectedRoute() {
  const token = useAuthStore((state) => state.token)
  const location = useLocation()
  if (isMockToken(token)) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

export default ProtectedRoute
