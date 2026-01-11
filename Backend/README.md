# MedLink Backend

This folder contains the backend server code for MedLink.

## Setup Instructions

1. Install Node.js (version 14 or higher) if you haven't already
2. Navigate to the Backend folder in your terminal
3. Install dependencies:
   ```
   npm install
   ```
4. Start the server:
   ```
   npm start
   ```
   
   For development with auto-restart:
   ```
   npm run dev
   ```

## Features

- **Express Server**: Handles API requests and serves frontend files
- **Medicine Listing Management**: Adds new listings to CSV file
- **CSV Database**: Uses the CSV file as a lightweight database
- **Image Upload**: Handles medicine images with secure storage
- **API Endpoints**:
  - `GET /api/medicines`: Get all medicine listings
  - `POST /api/medicines`: Add a new medicine listing with image
  - `GET /`: Home page
  - `GET /browse`: Browse medicines page

## How It Works

1. When a user submits the medicine listing form:
   - Form data and image are sent to the backend API via FormData
   - Backend generates a unique filename for the image
   - Image is stored in the Frontend/uploads directory
   - Medicine data and image path are appended to listings.csv
   - A success response is sent back to the frontend

2. When a user visits the browse medicines page:
   - Frontend fetches medicine data from the API
   - Backend reads the CSV file and returns the data as JSON with image URLs
   - Frontend displays the medicines as cards with images
   - Images are loaded from the uploads directory

## Project Structure

- `server.js`: Main server file with API routes and CSV handling
- `package.json`: Dependencies and scripts
- `../Data/listings.csv`: CSV file that stores medicine listings
- `../Frontend/uploads/`: Directory for storing medicine images

## Additional Notes

- The server creates Data/listings.csv if it doesn't exist
- The server creates Frontend/uploads directory if it doesn't exist
- All form submissions update the CSV file automatically
- Images are stored with unique filenames to prevent collisions
- Only image files are accepted for upload (enforced by the server)
- Maximum image size is limited to 5MB

