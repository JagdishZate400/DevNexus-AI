// Projects for documentation
export const documentationProjects = [
  { id: 'e-commerce-platform', name: 'E-Commerce Platform' },
  { id: 'task-management-system', name: 'Task Management System' },
  { id: 'portfolio-analyzer', name: 'Portfolio Analyzer' },
]

// Canonical IDs and labels are shared by active and legacy documentation components.
export {DOCUMENTATION_TYPES as documentTypes} from './documentationTypes'

// Generated documents in the library
export const generatedDocuments = [
  {
    id: 'doc-1',
    title: 'README',
    type: 'readme',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'Generated',
    updated: 'Today',
    content: `# E-Commerce Platform

## Overview

This is a mock generated documentation for the E-Commerce Platform project. In a real scenario, this would be generated using AI-assisted analysis of your codebase.

## Technology Stack

### Frontend
- React 18.x
- Vite
- Tailwind CSS
- TanStack Query
- React Router

### Backend
- Node.js
- Express.js
- PostgreSQL
- Sequelize ORM

## Quick Start

### Prerequisites
- Node.js 18+
- PostgreSQL 14+
- npm or yarn

### Installation
1. Clone the repository
2. Install dependencies: \`npm install\`
3. Configure environment variables in \`.env\`
4. Start the development server: \`npm run dev\`

### Environment Variables

Create a \`.env\` file in the root directory:

\`\`\`
DATABASE_URL=postgresql://user:password@localhost:5432/ecommerce
JWT_SECRET=your_jwt_secret
API_PORT=5000
\`\`\`

## Project Structure

\`\`\`
e-commerce-platform/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── services/
│   │   └── utils/
│   └── package.json
├── backend/
│   ├── routes/
│   ├── controllers/
│   ├── models/
│   └── package.json
└── README.md
\`\`\`

## Features

- User authentication and authorization
- Product catalog management
- Shopping cart functionality
- Order management
- Payment processing
- Admin dashboard

## Development

### Available Scripts

\`\`\`bash
npm run dev      # Start development server
npm run build    # Build for production
npm run lint     # Run linter
npm run test     # Run tests
\`\`\`

## Contributing

1. Create a feature branch
2. Commit your changes
3. Push to the branch
4. Create a Pull Request

## License

MIT License - See LICENSE file for details
`,
  },
  {
    id: 'doc-2',
    title: 'Architecture Documentation',
    type: 'architecture',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'Generated',
    updated: 'Yesterday',
    content: `# E-Commerce Platform - Architecture Documentation

## System Architecture

This document describes the high-level architecture of the E-Commerce Platform.

## Overview

The application follows a client-server architecture with clear separation of concerns:

### Frontend Architecture
- React-based single-page application
- Component-based UI structure
- TanStack Query for server state management
- React Router for navigation
- Tailwind CSS for styling

### Backend Architecture
- RESTful API built with Express.js
- PostgreSQL for persistent data storage
- Sequelize ORM for database abstraction
- JWT for authentication

## Layers

### Presentation Layer
- React components
- User interface components
- Form handling and validation

### Business Logic Layer
- Service classes
- Business rules implementation
- Data transformation

### Data Access Layer
- Database models
- Query builders
- Transaction management

## Data Flow

1. User interacts with React components
2. Components dispatch actions or call services
3. Services communicate with backend API
4. Backend processes requests and queries database
5. Response flows back through the chain

## Security Considerations

- JWT token-based authentication
- HTTPS/TLS encryption
- SQL injection prevention via ORM
- CORS configuration
- Input validation
- Rate limiting

## Scalability

- Stateless API design
- Database indexing strategy
- Caching layer consideration
- Load balancing capability
`,
  },
  {
    id: 'doc-3',
    title: 'API Documentation',
    type: 'api-documentation',
    project: 'Task Management System',
    projectId: 'task-management-system',
    status: 'Needs Update',
    updated: '2 days ago',
    content: `# Task Management System - API Documentation

## Base URL

\`https://api.taskmanagement.local/v1\`

## Authentication

All API requests require a valid JWT token in the Authorization header:

\`\`\`
Authorization: Bearer <token>
\`\`\`

## Endpoints

### Tasks

#### List Tasks
\`\`\`
GET /tasks
\`\`\`

Query Parameters:
- \`status\` - Filter by status (todo, in-progress, done)
- \`projectId\` - Filter by project ID
- \`page\` - Pagination page (default: 1)
- \`limit\` - Items per page (default: 20)

Response:
\`\`\`json
{
  "data": [
    {
      "id": "task-1",
      "title": "Implement user authentication",
      "description": "Add JWT-based authentication",
      "status": "in-progress",
      "priority": "high",
      "dueDate": "2026-09-10",
      "projectId": "project-1"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
\`\`\`

#### Create Task
\`\`\`
POST /tasks
\`\`\`

Request Body:
\`\`\`json
{
  "title": "Implement user authentication",
  "description": "Add JWT-based authentication",
  "projectId": "project-1",
  "priority": "high",
  "dueDate": "2026-09-10"
}
\`\`\`

Response:
\`\`\`json
{
  "id": "task-1",
  "title": "Implement user authentication",
  "description": "Add JWT-based authentication",
  "status": "todo",
  "priority": "high",
  "dueDate": "2026-09-10",
  "projectId": "project-1",
  "createdAt": "2026-09-05T10:30:00Z"
}
\`\`\`

#### Update Task
\`\`\`
PUT /tasks/:id
\`\`\`

Request Body:
\`\`\`json
{
  "title": "Updated task title",
  "status": "in-progress",
  "priority": "medium"
}
\`\`\`

#### Delete Task
\`\`\`
DELETE /tasks/:id
\`\`\`

Response: 204 No Content

## Error Responses

### 400 Bad Request
\`\`\`json
{
  "error": "Invalid request parameters",
  "details": {
    "title": "Title is required"
  }
}
\`\`\`

### 401 Unauthorized
\`\`\`json
{
  "error": "Invalid or expired token"
}
\`\`\`

### 403 Forbidden
\`\`\`json
{
  "error": "Insufficient permissions"
}
\`\`\`

### 404 Not Found
\`\`\`json
{
  "error": "Resource not found"
}
\`\`\`

### 500 Server Error
\`\`\`json
{
  "error": "Internal server error"
}
\`\`\`
`,
  },
  {
    id: 'doc-4',
    title: 'Installation Guide',
    type: 'installation-guide',
    project: 'Portfolio Analyzer',
    projectId: 'portfolio-analyzer',
    status: 'Generated',
    updated: '3 days ago',
    content: `# Portfolio Analyzer - Installation Guide

## System Requirements

### Minimum Requirements
- Python 3.9 or higher
- 4GB RAM
- 500MB disk space
- Node.js 16+ (for web interface)

### Recommended Requirements
- Python 3.11
- 8GB RAM
- 2GB disk space
- Node.js 18+ (LTS)

## Installation Steps

### Step 1: Clone Repository
\`\`\`bash
git clone https://github.com/your-org/portfolio-analyzer.git
cd portfolio-analyzer
\`\`\`

### Step 2: Setup Python Environment
\`\`\`bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\\Scripts\\activate
pip install --upgrade pip
pip install -r requirements.txt
\`\`\`

### Step 3: Setup Frontend
\`\`\`bash
cd web
npm install
\`\`\`

### Step 4: Configure Environment
Create a \`.env\` file in the root directory:

\`\`\`
# Python Backend
FLASK_ENV=development
DATABASE_URL=postgresql://localhost/portfolio_analyzer
SECRET_KEY=your-secret-key

# Web Frontend
REACT_APP_API_URL=http://localhost:5000
REACT_APP_ENV=development
\`\`\`

### Step 5: Initialize Database
\`\`\`bash
python manage.py db init
python manage.py db migrate
python manage.py db upgrade
\`\`\`

### Step 6: Load Sample Data (Optional)
\`\`\`bash
python scripts/load_sample_data.py
\`\`\`

### Step 7: Run Services

Terminal 1 - Backend:
\`\`\`bash
python manage.py run
# Server running on http://localhost:5000
\`\`\`

Terminal 2 - Frontend:
\`\`\`bash
cd web
npm start
# Application running on http://localhost:3000
\`\`\`

## Docker Installation (Alternative)

\`\`\`bash
docker-compose up -d
# Services will be available at:
# Frontend: http://localhost:3000
# Backend: http://localhost:5000
\`\`\`

## Verification

1. Open http://localhost:3000 in your browser
2. Login with default credentials:
   - Email: demo@example.com
   - Password: demo123

## Troubleshooting

### Python dependencies fail to install
\`\`\`bash
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
\`\`\`

### Port already in use
Change the port in your configuration:
\`\`\`
FLASK_RUN_PORT=5001
REACT_APP_API_URL=http://localhost:5001
\`\`\`

### Database connection issues
Verify PostgreSQL is running:
\`\`\`bash
psql -h localhost -U postgres
\`\`\`

## Next Steps

1. Review the [Architecture Documentation](./architecture.md)
2. Check out [Developer Setup Guide](./development-setup.md)
3. Read the [API Documentation](./api.md)
`,
  },
  {
    id: 'doc-5',
    title: 'Project Overview',
    type: 'project-overview',
    project: 'E-Commerce Platform',
    projectId: 'e-commerce-platform',
    status: 'Generated',
    updated: 'Today',
    content: `# E-Commerce Platform - Project Overview

## Project Summary

The E-Commerce Platform is a modern, full-stack application designed to provide a complete solution for online retail businesses. It offers a comprehensive product catalog, shopping cart functionality, secure payment processing, and an administrative dashboard for business management.

## Business Objectives

1. Provide a user-friendly shopping experience
2. Enable businesses to manage inventory and orders efficiently
3. Support multiple payment methods
4. Provide analytics and reporting capabilities
5. Scale to handle high transaction volumes

## Key Features

### Customer Features
- User registration and authentication
- Product browsing and search
- Shopping cart and wishlist
- Secure checkout process
- Order tracking
- Product reviews and ratings
- User dashboard and history

### Admin Features
- Product management
- Inventory tracking
- Order management
- User management
- Sales analytics
- Report generation
- Email notifications

## Technical Highlights

- **Modern Stack**: React, Node.js, PostgreSQL
- **Real-time Updates**: WebSocket integration for live notifications
- **Secure**: JWT authentication, encrypted passwords, HTTPS
- **Scalable**: Microservices-ready architecture
- **Responsive**: Mobile-first design
- **Performance**: Optimized queries, caching strategies

## Target Users

- Online retailers
- Small to medium-sized e-commerce businesses
- Entrepreneurs starting online stores
- Digital product vendors

## Success Metrics

- Page load time < 2 seconds
- 99.9% uptime
- Support for 10,000+ concurrent users
- < 1 second checkout process
- 95%+ customer satisfaction

## Timeline

- Phase 1 (Months 1-2): Core platform development
- Phase 2 (Months 3-4): Payment integration and testing
- Phase 3 (Months 5-6): Deployment and optimization
- Phase 4 (Ongoing): Maintenance and feature updates

## Team Structure

- Project Manager: 1
- Frontend Developers: 2
- Backend Developers: 2
- QA Engineer: 1
- DevOps Engineer: 1
`,
  },
  {
    id: 'doc-6',
    title: 'Module Documentation',
    type: 'module-documentation',
    project: 'Task Management System',
    projectId: 'task-management-system',
    status: 'Needs Update',
    updated: '1 week ago',
    content: `# Task Management System - Module Documentation

## Modules Overview

The Task Management System is composed of several key modules that work together to provide complete task management functionality.

## Authentication Module

**Purpose**: Handle user authentication and authorization

**Key Components**:
- \`LoginService\` - User login logic
- \`TokenManager\` - JWT token generation and validation
- \`PermissionChecker\` - Role-based access control

**Usage**:
\`\`\`javascript
import { LoginService } from './auth/LoginService'
const service = new LoginService()
const token = await service.login(email, password)
\`\`\`

## Task Module

**Purpose**: Manage task creation, updates, and retrieval

**Key Components**:
- \`TaskRepository\` - Database operations
- \`TaskService\` - Business logic
- \`TaskValidator\` - Input validation

**Key Methods**:
- \`createTask(data)\` - Create new task
- \`updateTask(id, data)\` - Update existing task
- \`getTask(id)\` - Retrieve task by ID
- \`listTasks(filters)\` - List tasks with filtering
- \`deleteTask(id)\` - Delete task

## Project Module

**Purpose**: Manage projects and project settings

**Key Components**:
- \`ProjectRepository\` - Database operations
- \`ProjectService\` - Business logic
- \`ProjectSettings\` - Configuration management

## Notification Module

**Purpose**: Handle email and in-app notifications

**Key Components**:
- \`EmailService\` - Email notifications
- \`NotificationQueue\` - Queue management
- \`NotificationTemplates\` - Template rendering

## Reporting Module

**Purpose**: Generate reports and analytics

**Key Components**:
- \`ReportGenerator\` - Report creation
- \`DataAggregator\` - Data collection and aggregation
- \`ChartBuilder\` - Chart generation

**Supported Reports**:
- Task completion rates
- Project progress
- Team productivity
- Time tracking

## Usage Examples

### Creating a Task
\`\`\`javascript
const taskService = new TaskService()
const task = await taskService.createTask({
  title: 'Implement feature X',
  description: 'Add new feature to dashboard',
  projectId: 'project-1',
  priority: 'high',
  dueDate: '2026-09-15'
})
\`\`\`

### Generating a Report
\`\`\`javascript
const reportGenerator = new ReportGenerator()
const report = await reportGenerator.generate({
  type: 'completion-rate',
  projectId: 'project-1',
  startDate: '2026-09-01',
  endDate: '2026-09-30'
})
\`\`\`
`,
  },
]

// Documentation coverage
export const documentationCoverage = [
  { type: 'Project Overview', coverage: 100 },
  { type: 'README', coverage: 100 },
  { type: 'Architecture', coverage: 80 },
  { type: 'API Documentation', coverage: 60 },
  { type: 'Module Documentation', coverage: 40 },
]

// Document type descriptions for the library view
export const documentTypeDescriptions = {
  'readme': 'Project overview and quick start guide',
  'project-overview': 'Comprehensive project summary and objectives',
  'installation-guide': 'Step-by-step installation instructions',
  'architecture': 'System architecture and design patterns',
  'project-structure': 'Directory organization and file structure',
  'module-documentation': 'Detailed module descriptions and usage',
  'api-documentation': 'API endpoints, parameters, and responses',
  'developer-notes': 'Development guidelines and conventions',
  'technology-stack': 'Technology choices and justifications',
}

// Stats for the dashboard
export const documentationStats = [
  { label: 'Documents Generated', value: '6', detail: 'Across all projects', icon: 'FileText' },
  { label: 'Project Guides', value: '3', detail: 'Project documentation', icon: 'BookOpen' },
  { label: 'API Documents', value: '2', detail: 'API references', icon: 'Code' },
  { label: 'Last Generated', value: 'Today', detail: 'Most recent update', icon: 'Clock' },
]

// Document types with metadata for display
export {DOCUMENTATION_TYPES as allDocumentTypesWithStatus} from './documentationTypes'

// Generation options for the modal
export const generationOptions = [
  { id: 'include-tech-stack', label: 'Include technology stack' },
  { id: 'include-structure', label: 'Include project structure' },
  { id: 'include-api', label: 'Include API information' },
  { id: 'include-setup', label: 'Include setup instructions' },
  { id: 'include-modules', label: 'Include module descriptions' },
]
