export const reviewProjects = [
  { id: 'e-commerce-platform', name: 'E-Commerce Platform', folders: ['backend/controllers', 'frontend/src/components'], files: ['backend/controllers/authController.js', 'backend/controllers/productController.js', 'frontend/src/components/ProductCard.jsx'] },
  { id: 'task-management-system', name: 'Task Management System', folders: ['backend/controllers', 'src/components'], files: ['backend/controllers/taskController.js', 'src/components/TaskBoard.jsx'] },
  { id: 'portfolio-analyzer', name: 'Portfolio Analyzer', folders: ['app', 'tests'], files: ['app/main.py', 'app/analyzer.py'] },
]

export const reviewStats = [
  { label: 'Total Reviews', value: '9', detail: '2 this month' },
  { label: 'Files Reviewed', value: '24', detail: 'Across 3 projects' },
  { label: 'Open Findings', value: '8', detail: '4 need attention' },
  { label: 'Resolved Findings', value: '15', detail: '65% of total findings' },
]

export const reviewHistory = [
  { id: 'review-ecommerce', project: 'E-Commerce Platform', scope: 'Entire Project', status: 'Completed', findings: 9, updated: '20 minutes ago' },
  { id: 'review-task', project: 'Task Management System', scope: 'backend/controllers', status: 'Completed', findings: 5, updated: 'Yesterday' },
  { id: 'review-portfolio', project: 'Portfolio Analyzer', scope: 'app/main.py', status: 'Completed', findings: 3, updated: '2 days ago' },
]

export const initialFindings = [
  { id: 'finding-1', severity: 'High', file: 'backend/controllers/authController.js', line: '42', category: 'Potential Bug', status: 'Open', problem: 'Login input is used before full validation.', explanation: 'The current flow may allow malformed input to reach authentication logic.', improvement: 'Validate email and password before executing authentication logic.', code: "const { email, password } = req.body\nconst user = await User.authenticate(email, password)" },
  { id: 'finding-2', severity: 'Medium', file: 'backend/controllers/productController.js', line: '78-92', category: 'Maintainability', status: 'Reviewed', problem: 'Repeated response-building logic.', explanation: 'Several controller branches construct similar response objects independently.', improvement: 'Extract repeated response formatting into a reusable helper.', code: "return res.status(200).json({\n  data: product,\n  message: 'Product loaded'\n})" },
  { id: 'finding-3', severity: 'Low', file: 'frontend/src/components/ProductCard.jsx', line: '31', category: 'Code Quality', status: 'Open', problem: 'Component contains multiple inline conditions.', explanation: 'Nested conditional rendering makes the component harder to scan and extend.', improvement: 'Extract conditional rendering into small helper functions.', code: "{isAvailable ? (\n  <BuyButton />\n) : isLoading ? (\n  <Spinner />\n) : null}" },
  { id: 'finding-4', severity: 'Info', file: 'backend/routes/productRoutes.js', line: '14', category: 'Best Practice', status: 'False Positive', problem: 'Route grouping could be more explicit.', explanation: 'The route works as expected, but a shared router prefix may improve discoverability.', improvement: 'Consider grouping product routes under a documented router prefix.', code: "router.get('/:productId', getProduct)" },
]

export const qualityMetrics = [
  { label: 'Readability', value: 82 },
  { label: 'Maintainability', value: 74 },
  { label: 'Performance', value: 78 },
  { label: 'Best Practices', value: 69 },
]

export const focusOptions = ['Code Quality', 'Maintainability', 'Potential Bugs', 'Security Concerns', 'Performance', 'Best Practices']
export const severityOptions = ['All', 'Critical', 'High', 'Medium', 'Low', 'Info']
export const categoryOptions = ['All', 'Code Quality', 'Maintainability', 'Potential Bug', 'Security', 'Performance', 'Best Practice']
export const statusOptions = ['All', 'Open', 'Reviewed', 'False Positive', 'Fixed']
