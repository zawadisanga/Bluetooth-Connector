#!/bin/bash

echo "🚀 Deploying Bluetooth Connector..."

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "Initializing git..."
    git init
fi

# Add all files
git add .

# Commit
git commit -m "Deploy Bluetooth Connector with PWA"

# Deploy to Render (if using Render)
echo "🌐 Deploying to Render..."
curl -X POST https://api.render.com/deploy/srv-xxxxx

# Deploy to Vercel (if using Vercel)
echo "🌐 Deploying to Vercel..."
vercel --prod

echo "✅ Deployment complete!"
echo "📱 Your app is now live and installable as PWA!"
