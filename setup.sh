#!/bin/bash

# Setup the timezone
sudo rm -rf /etc/localtime
sudo ln -s /usr/share/zoneinfo/America/New_York /etc/localtime

# Kill port 3000
npx kill-port 3000

# Move to dir
cd /home/ec2-user/gist-secrets

# Setup python
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Setup npm
npm install
forever stop server.js
forever start server.js $1

# Reload nginx
sudo nginx -s reload