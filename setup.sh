#!/bin/bash

# Setup the timezone
sudo rm -rf /etc/localtime
sudo ln -s /usr/share/zoneinfo/America/New_York /etc/localtime

# Move to dir
cd /home/ec2-user/gist-secrets

# Setup npm
npm install
forever stop server.js $1
forever start server.js $1

# Reload nginx
sudo nginx -s reload