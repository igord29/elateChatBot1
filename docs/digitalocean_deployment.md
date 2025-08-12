# DigitalOcean Deployment Guide

This guide provides comprehensive instructions for deploying the Elate Chatbot on DigitalOcean using Docker and Docker Compose.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [DigitalOcean Droplet Setup](#digitalocean-droplet-setup)
3. [Domain Configuration](#domain-configuration)
4. [Local Preparation](#local-preparation)
5. [Deployment Process](#deployment-process)
6. [Post-Deployment Configuration](#post-deployment-configuration)
7. [Monitoring and Maintenance](#monitoring-and-maintenance)
8. [Troubleshooting](#troubleshooting)
9. [Security Best Practices](#security-best-practices)
10. [Scaling Considerations](#scaling-considerations)

## Prerequisites

### Required Software
- Docker (version 20.10+)
- Docker Compose (version 2.0+)
- SSH client
- Domain name (optional but recommended)
- OpenAI API key
- Email service credentials

### DigitalOcean Account
- Active DigitalOcean account
- Payment method configured
- API token (optional, for automation)

## DigitalOcean Droplet Setup

### 1. Create a New Droplet

1. **Log into DigitalOcean**
   - Visit [digitalocean.com](https://digitalocean.com)
   - Sign in to your account

2. **Create Droplet**
   - Click "Create" → "Droplets"
   - Choose "Marketplace" tab
   - Select "Docker" image (recommended: Docker 20.10 on Ubuntu 22.04)

3. **Configure Droplet**
   - **Size**: Choose based on expected traffic:
     - **Basic**: 1GB RAM, 1 vCPU (up to 100 concurrent users)
     - **Standard**: 2GB RAM, 1 vCPU (up to 500 concurrent users)
     - **Professional**: 4GB RAM, 2 vCPU (up to 1000+ concurrent users)
   - **Datacenter**: Choose closest to your target users
   - **Authentication**: SSH key (recommended) or password
   - **Hostname**: `elate-chatbot` or your preferred name

4. **Create Droplet**
   - Click "Create Droplet"
   - Wait for droplet to be ready (usually 1-2 minutes)

### 2. Configure Firewall

1. **Create Firewall Rules**
   - Go to "Networking" → "Firewalls"
   - Click "Create Firewall"

2. **Inbound Rules**
   ```
   HTTP (80) - All IPv4, All IPv6
   HTTPS (443) - All IPv4, All IPv6
   SSH (22) - Your IP address only
   Custom (3000) - Your IP address only (Grafana)
   Custom (9090) - Your IP address only (Prometheus)
   Custom (5555) - Your IP address only (Celery Flower)
   ```

3. **Outbound Rules**
   ```
   All TCP - All IPv4, All IPv6
   All UDP - All IPv4, All IPv6
   All ICMP - All IPv4, All IPv6
   ```

4. **Apply to Droplet**
   - Select your droplet
   - Apply the firewall

### 3. Initial Server Setup

1. **SSH into Droplet**
   ```bash
   ssh root@your-droplet-ip
   ```

2. **Update System**
   ```bash
   apt update && apt upgrade -y
   ```

3. **Install Additional Packages**
   ```bash
   apt install -y curl wget git htop ufw fail2ban
   ```

4. **Configure UFW (Uncomplicated Firewall)**
   ```bash
   ufw allow ssh
   ufw allow 80
   ufw allow 443
   ufw --force enable
   ```

5. **Install Fail2ban**
   ```bash
   systemctl enable fail2ban
   systemctl start fail2ban
   ```

## Domain Configuration

### 1. DNS Setup

1. **Add A Records**
   - Go to your domain registrar's DNS settings
   - Add A record: `@` → `your-droplet-ip`
   - Add A record: `www` → `your-droplet-ip`

2. **Optional: Add CNAME Records**
   - `api.your-domain.com` → `your-domain.com`
   - `admin.your-domain.com` → `your-domain.com`

### 2. SSL Certificate (Let's Encrypt)

The deployment script will automatically handle SSL certificate generation using Let's Encrypt.

## Local Preparation

### 1. Clone Repository

```bash
git clone https://github.com/your-username/elate-chatbot.git
cd elate-chatbot
```

### 2. Configure Environment

1. **Copy Environment Template**
   ```bash
   cp env.prod.example .env
   ```

2. **Edit Environment Variables**
   ```bash
   nano .env
   ```

   **Required Changes:**
   - `ALLOWED_HOSTS`: Your domain and droplet IP
   - `CSRF_TRUSTED_ORIGINS`: Your domain with https://
   - `OPENAI_API_KEY`: Your OpenAI API key
   - `EMAIL_*`: Your email service credentials

### 3. Make Deployment Script Executable

```bash
chmod +x deploy.sh
```

## Deployment Process

### 1. Automated Deployment

1. **Run Deployment Script**
   ```bash
   ./deploy.sh your-domain.com your-droplet-ip admin@your-domain.com
   ```

2. **Monitor Deployment**
   - The script will show progress with colored output
   - Wait for all services to start (usually 5-10 minutes)

### 2. Manual Deployment (Alternative)

If you prefer manual deployment:

1. **Upload Files to Droplet**
   ```bash
   scp -r . root@your-droplet-ip:/root/elate-chatbot
   ```

2. **SSH into Droplet**
   ```bash
   ssh root@your-droplet-ip
   cd elate-chatbot
   ```

3. **Run Deployment Steps**
   ```bash
   # Generate secrets
   ./deploy.sh your-domain.com your-droplet-ip admin@your-domain.com
   ```

### 3. Verify Deployment

1. **Check Service Status**
   ```bash
   docker-compose -f docker-compose.prod.yml ps
   ```

2. **Check Logs**
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f
   ```

3. **Test Website**
   - Visit `https://your-domain.com`
   - Check health endpoint: `https://your-domain.com/health/`

## Post-Deployment Configuration

### 1. Create Admin User

```bash
docker-compose -f docker-compose.prod.yml exec web python manage.py createsuperuser
```

### 2. Configure Email Settings

1. **Update Email Configuration**
   ```bash
   nano .env
   ```

2. **Test Email**
   ```bash
   docker-compose -f docker-compose.prod.yml exec web python manage.py shell
   ```
   ```python
   from django.core.mail import send_mail
   send_mail('Test Email', 'This is a test email.', 'from@example.com', ['to@example.com'])
   ```

### 3. Configure OpenAI

1. **Set OpenAI API Key**
   ```bash
   nano .env
   # Update OPENAI_API_KEY
   ```

2. **Test OpenAI Integration**
   - Visit your website
   - Try sending a message to the chatbot

### 4. Setup Monitoring

1. **Access Grafana**
   - Visit `https://your-domain.com:3000`
   - Username: `admin`
   - Password: (check deployment output or .env file)

2. **Configure Dashboards**
   - Import default dashboards
   - Set up alerts

3. **Access Prometheus**
   - Visit `https://your-domain.com:9090`
   - Check metrics collection

## Monitoring and Maintenance

### 1. Regular Maintenance

1. **Update System**
   ```bash
   apt update && apt upgrade -y
   docker system prune -f
   ```

2. **Backup Data**
   ```bash
   ./backup.sh
   ```

3. **Monitor Logs**
   ```bash
   docker-compose -f docker-compose.prod.yml logs -f
   ```

### 2. Performance Monitoring

1. **Check Resource Usage**
   ```bash
   htop
   docker stats
   ```

2. **Monitor Application Metrics**
   - Grafana dashboards
   - Prometheus metrics
   - Celery Flower for task monitoring

### 3. Scaling

1. **Vertical Scaling (More Resources)**
   - Upgrade droplet size in DigitalOcean
   - Restart services: `docker-compose -f docker-compose.prod.yml restart`

2. **Horizontal Scaling (More Instances)**
   - Add load balancer
   - Deploy multiple droplets
   - Use managed database service

## Troubleshooting

### Common Issues

#### 1. SSL Certificate Issues

**Problem**: SSL certificate not working
**Solution**:
```bash
# Check certificate status
docker-compose -f docker-compose.prod.yml exec nginx nginx -t

# Renew certificates
docker run --rm -v $(pwd)/nginx/ssl:/etc/letsencrypt certbot/certbot renew
```

#### 2. Database Connection Issues

**Problem**: Cannot connect to database
**Solution**:
```bash
# Check database status
docker-compose -f docker-compose.prod.yml exec db pg_isready -U elate_user

# Restart database
docker-compose -f docker-compose.prod.yml restart db
```

#### 3. Redis Connection Issues

**Problem**: Redis connection failed
**Solution**:
```bash
# Check Redis status
docker-compose -f docker-compose.prod.yml exec redis redis-cli ping

# Restart Redis
docker-compose -f docker-compose.prod.yml restart redis
```

#### 4. Celery Worker Issues

**Problem**: Background tasks not working
**Solution**:
```bash
# Check Celery status
docker-compose -f docker-compose.prod.yml exec celery celery -A elate_chatbot inspect active

# Restart Celery
docker-compose -f docker-compose.prod.yml restart celery celery-beat
```

#### 5. Static Files Not Loading

**Problem**: CSS/JS files not loading
**Solution**:
```bash
# Collect static files
docker-compose -f docker-compose.prod.yml exec web python manage.py collectstatic --noinput

# Restart web service
docker-compose -f docker-compose.prod.yml restart web
```

### Debug Commands

```bash
# Check all service logs
docker-compose -f docker-compose.prod.yml logs

# Check specific service logs
docker-compose -f docker-compose.prod.yml logs web

# Check service status
docker-compose -f docker-compose.prod.yml ps

# Access Django shell
docker-compose -f docker-compose.prod.yml exec web python manage.py shell

# Check database migrations
docker-compose -f docker-compose.prod.yml exec web python manage.py showmigrations

# Run Django checks
docker-compose -f docker-compose.prod.yml exec web python manage.py check --deploy
```

## Security Best Practices

### 1. Firewall Configuration

- Only allow necessary ports
- Use SSH key authentication
- Regularly update firewall rules

### 2. SSL/TLS Security

- Use strong SSL ciphers
- Enable HSTS
- Regular certificate renewal

### 3. Application Security

- Keep Django and dependencies updated
- Use strong secret keys
- Enable security middleware
- Regular security audits

### 4. Database Security

- Use strong passwords
- Limit database access
- Regular backups
- Encrypt sensitive data

### 5. Monitoring Security

- Secure monitoring endpoints
- Use strong passwords for Grafana
- Regular access reviews

## Scaling Considerations

### 1. Performance Optimization

- **Caching**: Redis for session and query caching
- **CDN**: Use Cloudflare or similar for static files
- **Database**: Optimize queries and use indexing
- **Load Balancing**: Use DigitalOcean Load Balancer

### 2. High Availability

- **Multiple Droplets**: Deploy across multiple regions
- **Database Clustering**: Use managed PostgreSQL
- **Backup Strategy**: Automated backups with off-site storage
- **Monitoring**: Comprehensive monitoring and alerting

### 3. Cost Optimization

- **Right-sizing**: Choose appropriate droplet sizes
- **Reserved Instances**: Use DigitalOcean reserved instances
- **Resource Monitoring**: Monitor and optimize resource usage
- **Cleanup**: Regular cleanup of unused resources

## Support and Resources

### Documentation
- [Django Documentation](https://docs.djangoproject.com/)
- [Docker Documentation](https://docs.docker.com/)
- [DigitalOcean Documentation](https://docs.digitalocean.com/)

### Community
- [Django Forum](https://forum.djangoproject.com/)
- [Docker Community](https://community.docker.com/)
- [DigitalOcean Community](https://www.digitalocean.com/community/)

### Monitoring Tools
- [Grafana](https://grafana.com/)
- [Prometheus](https://prometheus.io/)
- [Celery Flower](https://flower.readthedocs.io/)

---

## Quick Reference

### Essential Commands

```bash
# Start services
docker-compose -f docker-compose.prod.yml up -d

# Stop services
docker-compose -f docker-compose.prod.yml down

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart services
docker-compose -f docker-compose.prod.yml restart

# Backup data
./backup.sh

# Update application
git pull
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Important URLs

- **Website**: `https://your-domain.com`
- **Admin Panel**: `https://your-domain.com/admin/`
- **API Docs**: `https://your-domain.com/api/docs/`
- **Grafana**: `https://your-domain.com:3000`
- **Prometheus**: `https://your-domain.com:9090`
- **Celery Flower**: `https://your-domain.com:5555`

### Environment Variables

Key environment variables to configure:
- `SECRET_KEY`: Django secret key
- `ALLOWED_HOSTS`: Domain and IP addresses
- `OPENAI_API_KEY`: OpenAI API key
- `EMAIL_*`: Email service configuration
- `DB_PASSWORD`: Database password

---

This deployment guide provides a comprehensive approach to deploying the Elate Chatbot on DigitalOcean. Follow the steps carefully and refer to the troubleshooting section if you encounter any issues.
