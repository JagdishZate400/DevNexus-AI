export const projectContextInfo = {
  'e-commerce-platform': {
    name: 'E-Commerce Platform',
    filesCount: 42,
    status: 'Indexed',
    statusDetail: 'Knowledge Base Ready',
    stack: ['React', 'Node.js', 'PostgreSQL'],
  },
  'task-management-system': {
    name: 'Task Management System',
    filesCount: 38,
    status: 'Indexed',
    statusDetail: 'Knowledge Base Ready',
    stack: ['React', 'Express', 'PostgreSQL'],
  },
  'portfolio-analyzer': {
    name: 'Portfolio Analyzer',
    filesCount: 18,
    status: 'Analysis Complete',
    statusDetail: 'Knowledge Base Ready',
    stack: ['Python', 'FastAPI', 'AI'],
  },
}

export const suggestedQuestions = {
  'e-commerce-platform': [
    'Where is authentication implemented?',
    'Explain the login flow.',
    'Which files handle product APIs?',
    'How does the frontend communicate with the backend?',
    'Which libraries are used?',
    'Explain the database structure.',
  ],
  'task-management-system': [
    'How is task state managed?',
    'Explain the project structure.',
    'Which files handle API communication?',
    'How are real-time updates handled?',
    'What database schema is used?',
    'Explain the authentication flow.',
  ],
  'portfolio-analyzer': [
    'Where is FastAPI initialized?',
    'Which module performs analysis?',
    'Explain the API routes.',
    'Which Python libraries are used?',
    'How does the analysis engine work?',
    'What data models are defined?',
  ],
}

export const mockConversations = [
  {
    id: 'conv-1',
    title: 'Authentication Flow',
    projectId: 'e-commerce-platform',
    timestamp: new Date(Date.now() - 5 * 60000), // 5 min ago
    messages: [
      {
        id: 'msg-1',
        role: 'user',
        content: 'Where is authentication implemented?',
        timestamp: new Date(Date.now() - 4 * 60000),
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: `Authentication is primarily implemented in the following project files:

1. **backend/controllers/authController.js**
   Handles login and authentication-related request logic.

2. **backend/routes/authRoutes.js**
   Defines authentication API routes and endpoints.

3. **backend/middleware/authMiddleware.js**
   Contains middleware used to validate authenticated requests.

The frontend login flow is primarily handled by:

**frontend/src/pages/auth/LoginPage.jsx**

The authentication flow uses JWT tokens for session management. Passwords are hashed using bcrypt before storage.`,
        timestamp: new Date(Date.now() - 3 * 60000),
        sources: [
          'backend/controllers/authController.js',
          'backend/routes/authRoutes.js',
          'backend/middleware/authMiddleware.js',
          'frontend/src/pages/auth/LoginPage.jsx',
        ],
      },
      {
        id: 'msg-3',
        role: 'user',
        content: 'Explain the login flow step by step.',
        timestamp: new Date(Date.now() - 2 * 60000),
      },
      {
        id: 'msg-4',
        role: 'assistant',
        content: `The login flow in the E-Commerce Platform follows these steps:

1. **User Submission**: User enters credentials in the LoginPage component and clicks the login button.

2. **Frontend Validation**: Basic validation is performed on the frontend (email format, password length).

3. **API Request**: The frontend sends a POST request to \`/api/auth/login\` with the credentials.

4. **Backend Validation**: The authController validates the credentials against the database.

5. **Password Verification**: Using bcrypt, the submitted password is compared against the stored hash.

6. **Token Generation**: Upon successful authentication, a JWT token is created using \`jsonwebtoken\` library.

7. **Response**: The token is returned to the frontend and stored in localStorage or a secure cookie.

8. **Protected Requests**: For subsequent requests, the authMiddleware validates the token in the Authorization header.

9. **Access Control**: If the token is valid, the request proceeds; otherwise, a 401 Unauthorized response is returned.

This implementation ensures secure authentication with stateless token-based sessions.`,
        timestamp: new Date(Date.now() - 1 * 60000),
        sources: [
          'backend/controllers/authController.js',
          'backend/middleware/authMiddleware.js',
          'backend/routes/authRoutes.js',
        ],
      },
    ],
  },
  {
    id: 'conv-2',
    title: 'Database Architecture',
    projectId: 'e-commerce-platform',
    timestamp: new Date(Date.now() - 1 * 24 * 60 * 60000), // Yesterday
    messages: [
      {
        id: 'msg-5',
        role: 'user',
        content: 'What is the database structure?',
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60000),
      },
      {
        id: 'msg-6',
        role: 'assistant',
        content: `The E-Commerce Platform uses PostgreSQL as its database with the following key tables:

**Users Table**
- id (PRIMARY KEY)
- email (UNIQUE)
- passwordHash
- firstName, lastName
- createdAt, updatedAt

**Products Table**
- id (PRIMARY KEY)
- name
- description
- price
- inventory
- categoryId (FOREIGN KEY)
- createdAt, updatedAt

**Orders Table**
- id (PRIMARY KEY)
- userId (FOREIGN KEY)
- totalAmount
- status
- createdAt, updatedAt

**OrderItems Table**
- id (PRIMARY KEY)
- orderId (FOREIGN KEY)
- productId (FOREIGN KEY)
- quantity
- price

**Categories Table**
- id (PRIMARY KEY)
- name
- description

All tables are connected with appropriate foreign key relationships to maintain data integrity.`,
        timestamp: new Date(Date.now() - 1 * 24 * 60 * 60000),
        sources: [
          'backend/models/User.js',
          'backend/models/Product.js',
          'backend/models/Order.js',
        ],
      },
    ],
  },
  {
    id: 'conv-3',
    title: 'API Explanation',
    projectId: 'task-management-system',
    timestamp: new Date(Date.now() - 2 * 24 * 60 * 60000), // 2 days ago
    messages: [
      {
        id: 'msg-7',
        role: 'user',
        content: 'How is the API structured?',
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60000),
      },
      {
        id: 'msg-8',
        role: 'assistant',
        content: `The Task Management System API is built using Express.js and follows RESTful conventions.

**API Routes Structure:**

\`/api/projects\` - Project management
- GET /api/projects - List all projects
- POST /api/projects - Create new project
- GET /api/projects/:id - Get project details
- PUT /api/projects/:id - Update project
- DELETE /api/projects/:id - Delete project

\`/api/tasks\` - Task management
- GET /api/tasks - List all tasks
- POST /api/tasks - Create new task
- GET /api/tasks/:id - Get task details
- PUT /api/tasks/:id - Update task
- DELETE /api/tasks/:id - Delete task

\`/api/auth\` - Authentication
- POST /api/auth/login - User login
- POST /api/auth/register - User registration
- POST /api/auth/logout - User logout

All endpoints are protected by JWT authentication middleware where applicable.`,
        timestamp: new Date(Date.now() - 2 * 24 * 60 * 60000),
        sources: [
          'backend/routes/projects.js',
          'backend/routes/tasks.js',
          'backend/routes/auth.js',
        ],
      },
    ],
  },
  {
    id: 'conv-4',
    title: 'FastAPI Structure',
    projectId: 'portfolio-analyzer',
    timestamp: new Date(Date.now() - 3 * 24 * 60 * 60000), // 3 days ago
    messages: [
      {
        id: 'msg-9',
        role: 'user',
        content: 'Where is FastAPI initialized?',
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60000),
      },
      {
        id: 'msg-10',
        role: 'assistant',
        content: `The Portfolio Analyzer project uses FastAPI and is initialized in the following way:

**Main Application File: main.py**

\`\`\`python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analysis, portfolio

app = FastAPI(
    title="Portfolio Analyzer API",
    description="AI-assisted portfolio analysis tool",
    version="1.0.0"
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(analysis.router, prefix="/api/analysis", tags=["analysis"])
app.include_router(portfolio.router, prefix="/api/portfolio", tags=["portfolio"])

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}
\`\`\`

The application initializes with CORS support for the frontend and includes routers for analysis and portfolio endpoints.`,
        timestamp: new Date(Date.now() - 3 * 24 * 60 * 60000),
        sources: ['main.py', 'app/routers/analysis.py', 'app/routers/portfolio.py'],
      },
    ],
  },
]

export const mockSourceFiles = {
  'backend/controllers/authController.js': {
    language: 'javascript',
    path: 'backend/controllers/authController.js',
    snippet: `const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

exports.login = async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const isValid = await bcrypt.compare(password, user.passwordHash);
    
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};`,
  },
  'backend/routes/authRoutes.js': {
    language: 'javascript',
    path: 'backend/routes/authRoutes.js',
    snippet: `const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/logout', authController.logout);

module.exports = router;`,
  },
  'backend/middleware/authMiddleware.js': {
    language: 'javascript',
    path: 'backend/middleware/authMiddleware.js',
    snippet: `const jwt = require('jsonwebtoken');

module.exports = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};`,
  },
  'frontend/src/pages/auth/LoginPage.jsx': {
    language: 'jsx',
    path: 'frontend/src/pages/auth/LoginPage.jsx',
    snippet: `import { useState } from 'react';

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      
      if (!response.ok) {
        throw new Error('Login failed');
      }
      
      const data = await response.json();
      localStorage.setItem('token', data.token);
      // Redirect to dashboard
    } catch (err) {
      setError(err.message);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      {/* Form fields */}
    </form>
  );
}

export default LoginPage;`,
  },
}
