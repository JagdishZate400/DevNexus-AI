import { createBrowserRouter } from 'react-router-dom'
import RootLayout from '../layouts/RootLayout'
import AuthLayout from '../layouts/AuthLayout'
import GuestRoute from '../components/auth/GuestRoute'
import ProtectedRoute from '../components/auth/ProtectedRoute'
import AIChatPage from '../pages/AIChatPage'
import CodeReviewPage from '../pages/CodeReviewPage'
import DashboardPage from '../pages/DashboardPage'
import DocumentationPage from '../pages/DocumentationPage'
import LandingPage from '../pages/LandingPage'
import NotFoundPage from '../pages/NotFoundPage'
import ProjectsPage from '../pages/ProjectsPage'
import ProjectDetailsPage from '../pages/ProjectDetailsPage'
import ReportsPage from '../pages/ReportsPage'
import SecurityPage from '../pages/SecurityPage'
import SettingsPage from '../pages/SettingsPage'
import SprintsPage from '../pages/SprintsPage'
import TasksPage from '../pages/TasksPage'
import TeamPage from '../pages/TeamPage'
import WorkspacePage from '../pages/WorkspacePage'
import LoginPage from '../pages/auth/LoginPage'
import RegisterPage from '../pages/auth/RegisterPage'
import ForgotPasswordPage from '../pages/auth/ForgotPasswordPage'
import ResetPasswordPage from '../pages/auth/ResetPasswordPage'

export const router = createBrowserRouter([
  // Public introduction page.
  { path: '/', element: <LandingPage /> },
  {
    element: <GuestRoute />,
    children: [
      {
        element: <AuthLayout />,
        children: [
          { path: '/login', element: <LoginPage /> },
          { path: '/register', element: <RegisterPage /> },
          { path: '/forgot-password', element: <ForgotPasswordPage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <RootLayout />,
        children: [
          { path: 'dashboard', element: <DashboardPage /> },
          { path: 'projects', element: <ProjectsPage /> },
          { path: 'projects/:projectId', element: <ProjectDetailsPage /> },
          { path: 'workspace', element: <WorkspacePage /> },
          { path: 'ai-chat', element: <AIChatPage /> },
          { path: 'code-review', element: <CodeReviewPage /> },
          { path: 'security', element: <SecurityPage /> },
          { path: 'documentation', element: <DocumentationPage /> },
          { path: 'tasks', element: <TasksPage /> },
          { path: 'sprints', element: <SprintsPage /> },
          { path: 'team', element: <TeamPage /> },
          { path: 'reports', element: <ReportsPage /> },
          { path: 'settings', element: <SettingsPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
