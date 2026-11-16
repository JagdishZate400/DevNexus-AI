export const workspaceProjects = [
  {
    id: 'e-commerce-platform',
    name: 'E-Commerce Platform',
    stack: ['React', 'Node.js', 'Express', 'PostgreSQL'],
    summary: { files: 42, folders: 13, languages: 3, dependencies: 18 },
    modules: ['Authentication', 'Products', 'Orders', 'Payments'],
    statuses: { upload: 'Mock Project Loaded', analysis: 'Not Started', indexing: 'Not Indexed', knowledgeBase: 'Not Created' },
    tree: [
      { name: 'frontend', type: 'folder', children: [{ name: 'src', type: 'folder', children: [{ name: 'components', type: 'folder', children: [{ name: 'Navbar.jsx', type: 'file', language: 'JavaScript', size: '2.1 KB', updated: '30 minutes ago' }, { name: 'ProductCard.jsx', type: 'file', language: 'JavaScript', size: '3.4 KB', updated: '1 hour ago' }] }, { name: 'pages', type: 'folder', children: [{ name: 'LoginPage.jsx', type: 'file', language: 'JavaScript', size: '2.8 KB', updated: '2 hours ago' }, { name: 'ProductsPage.jsx', type: 'file', language: 'JavaScript', size: '4.1 KB', updated: 'Yesterday' }] }, { name: 'App.jsx', type: 'file', language: 'JavaScript', size: '1.6 KB', updated: '30 minutes ago' }, { name: 'main.jsx', type: 'file', language: 'JavaScript', size: '0.8 KB', updated: 'Yesterday' }] }, { name: 'package.json', type: 'file', language: 'JSON', size: '1.2 KB', updated: 'Yesterday' }] },
      { name: 'backend', type: 'folder', children: [{ name: 'controllers', type: 'folder', children: [{ name: 'authController.js', type: 'file', language: 'JavaScript', size: '4.2 KB', updated: '30 minutes ago' }, { name: 'productController.js', type: 'file', language: 'JavaScript', size: '5.1 KB', updated: '3 hours ago' }] }, { name: 'routes', type: 'folder', children: [{ name: 'authRoutes.js', type: 'file', language: 'JavaScript', size: '1.4 KB', updated: 'Today' }, { name: 'productRoutes.js', type: 'file', language: 'JavaScript', size: '1.7 KB', updated: 'Yesterday' }] }, { name: 'middleware', type: 'folder', children: [{ name: 'authMiddleware.js', type: 'file', language: 'JavaScript', size: '2.3 KB', updated: '2 days ago' }] }, { name: 'server.js', type: 'file', language: 'JavaScript', size: '2.8 KB', updated: 'Today' }, { name: 'package.json', type: 'file', language: 'JSON', size: '1.1 KB', updated: 'Yesterday' }] },
      { name: 'database', type: 'folder', children: [{ name: 'schema.sql', type: 'file', language: 'SQL', size: '6.2 KB', updated: '3 days ago' }] },
      { name: 'README.md', type: 'file', language: 'Markdown', size: '3.6 KB', updated: 'Yesterday' },
    ],
  },
  {
    id: 'task-management-system', name: 'Task Management System', stack: ['React', 'Express', 'PostgreSQL'], summary: { files: 28, folders: 9, languages: 3, dependencies: 14 }, modules: ['Projects', 'Tasks', 'Sprints', 'Team'], statuses: { upload: 'Mock Project Loaded', analysis: 'Not Started', indexing: 'Not Indexed', knowledgeBase: 'Not Created' }, tree: [{ name: 'src', type: 'folder', children: [{ name: 'components', type: 'folder', children: [{ name: 'TaskBoard.jsx', type: 'file', language: 'JavaScript', size: '4.8 KB', updated: 'Today' }, { name: 'TaskCard.jsx', type: 'file', language: 'JavaScript', size: '2.2 KB', updated: 'Yesterday' }] }, { name: 'App.jsx', type: 'file', language: 'JavaScript', size: '1.8 KB', updated: 'Today' }] }, { name: 'server', type: 'folder', children: [{ name: 'routes.js', type: 'file', language: 'JavaScript', size: '2.4 KB', updated: 'Yesterday' }] }, { name: 'README.md', type: 'file', language: 'Markdown', size: '2.9 KB', updated: '2 days ago' }],
  },
  {
    id: 'portfolio-analyzer', name: 'Portfolio Analyzer', stack: ['Python', 'FastAPI', 'AI'], summary: { files: 19, folders: 7, languages: 2, dependencies: 11 }, modules: ['Ingestion', 'Analysis', 'Reports'], statuses: { upload: 'Mock Project Loaded', analysis: 'Analysis not started', indexing: 'Not Indexed', knowledgeBase: 'Not Created' }, tree: [{ name: 'app', type: 'folder', children: [{ name: 'main.py', type: 'file', language: 'Python', size: '2.7 KB', updated: 'Today' }, { name: 'analyzer.py', type: 'file', language: 'Python', size: '5.8 KB', updated: 'Yesterday' }] }, { name: 'tests', type: 'folder', children: [{ name: 'test_analyzer.py', type: 'file', language: 'Python', size: '2.1 KB', updated: '2 days ago' }] }, { name: 'requirements.txt', type: 'file', language: 'Text', size: '0.6 KB', updated: 'Yesterday' }, { name: 'README.md', type: 'file', language: 'Markdown', size: '3.1 KB', updated: '3 days ago' }],
  },
]

export const mockFileContents = {
  'authController.js': "const jwt = require('jsonwebtoken')\nconst User = require('../models/User')\n\nexport async function login(req, res) {\n  const { email, password } = req.body\n  const user = await User.authenticate(email, password)\n\n  if (!user) {\n    return res.status(401).json({ message: 'Invalid credentials' })\n  }\n\n  const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET)\n  return res.json({ token })\n}",
  'App.jsx': "import { BrowserRouter } from 'react-router-dom'\nimport AppRoutes from './routes/AppRoutes'\n\nexport default function App() {\n  return (\n    <BrowserRouter>\n      <AppRoutes />\n    </BrowserRouter>\n  )\n}",
  'main.py': "from fastapi import FastAPI\nfrom app.analyzer import analyze_portfolio\n\napp = FastAPI(title='Portfolio Analyzer')\n\n@app.get('/health')\ndef health_check():\n    return {'status': 'ready'}\n\n@app.post('/analyze')\ndef analyze(payload: dict):\n    return analyze_portfolio(payload)",
  'README.md': '# Project workspace\n\nThis project is loaded with mock source data for the frontend workspace preview.\n\nAnalysis and indexing will be connected in a later phase.',
}

export function getFileContent(file) {
  return mockFileContents[file.name] || `// Mock preview for ${file.name}\n// File analysis will be available in a later phase.`
}
