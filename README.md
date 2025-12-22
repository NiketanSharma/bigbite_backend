# BigBite Backend API

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the backend directory with the following variables:

```env
NODE_ENV=development
PORT=5000

# MongoDB
MONGODB_URI=mongodb://localhost:27017/bigbite

# JWT
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRE=30d

# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:5000/api/auth/google/callback

# Frontend URL
FRONTEND_URL=http://localhost:5174

# Session Secret
SESSION_SECRET=your-session-secret-change-this-in-production
```

### 3. Set Up Google OAuth (Optional)

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable Google+ API
4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
5. Set Authorized redirect URI: `http://localhost:5000/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env` file

### 4. Start MongoDB
Make sure MongoDB is running on your system:

```bash
# Windows
mongod

# Mac/Linux
sudo mongod
```

Or use MongoDB Atlas (cloud) and update the MONGODB_URI in `.env`

### 5. Run the Server

Development mode:
```bash
npm run dev
```

Production mode:
```bash
npm start
```

## API Endpoints

### Authentication

#### Register User
- **POST** `/api/auth/signup`
- Body: `{ name, email, phone, password, role }`
- Roles: `customer`, `rider`, `restaurant`

#### Login User
- **POST** `/api/auth/login`
- Body: `{ email, password }`

#### Get Current User
- **GET** `/api/auth/me`
- Headers: `Authorization: Bearer {token}`

#### Logout User
- **POST** `/api/auth/logout`
- Headers: `Authorization: Bearer {token}`

#### Update Profile
- **PUT** `/api/auth/update-profile`
- Headers: `Authorization: Bearer {token}`
- Body: `{ name, phone, address }`

#### Google OAuth Login
- **GET** `/api/auth/google`
- Redirects to Google login page

#### Google OAuth Callback
- **GET** `/api/auth/google/callback`
- Handled by Passport.js

## User Roles

- **customer**: Regular users who order food
- **rider**: Delivery riders who deliver orders
- **restaurant**: Restaurant partners who manage their menu
- **admin**: Platform administrators (not available for signup)

  
