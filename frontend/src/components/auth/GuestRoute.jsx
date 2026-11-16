import { Navigate, Outlet } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import { isMockToken } from '../../services/api'

function GuestRoute() {
  const token = useAuthStore((state) => state.token)
  if (token && !isMockToken(token)) {
    return <Navigate to="/dashboard" replace />
  }
  return <Outlet />
}

export default GuestRoute
