#!/bin/sh

# Check if CLOUDFLARE environment variable is set to 1
if [ "$CLOUDFLARE" = "1" ]; then
    echo "CLOUDFLARE is set to 1. Proceeding with the update."

    # Define URLs for Cloudflare IP lists
    CF_IPV4_URL="https://www.cloudflare.com/ips-v4"
    CF_IPV6_URL="https://www.cloudflare.com/ips-v6"

    # Define the path to your NGINX configuration file
    NGINX_CONF="/etc/nginx/conf.d/default.conf"

    # Download the Cloudflare IP lists
    CF_IPV4=$(curl -s $CF_IPV4_URL)
    CF_IPV6=$(curl -s $CF_IPV6_URL)

    # Backup the original NGINX configuration file
    cp $NGINX_CONF "${NGINX_CONF}.backup"

    # Remove existing Cloudflare IPs in default.conf (optional)
    sed -i '/set_real_ip_from/d' $NGINX_CONF
    sed -i '/real_ip_header CF-Connecting-IP;/d' $NGINX_CONF
    sed -i '/real_ip_recursive on;/d' $NGINX_CONF

    # Create a temporary file to hold the new configuration content
    TEMP_FILE=$(mktemp /tmp/cloudflare.XXXXXX)

    # Add the Cloudflare IPs to the temporary file with proper indentation
    echo "    # Cloudflare IPs" > $TEMP_FILE
    for ip in $CF_IPV4; do
        echo "    set_real_ip_from $ip;" >> $TEMP_FILE
    done
    for ip in $CF_IPV6; do
        echo "    set_real_ip_from $ip;" >> $TEMP_FILE
    done

    # Add the real_ip_header and real_ip_recursive directives with proper indentation
    echo "    real_ip_header CF-Connecting-IP;" >> $TEMP_FILE
    echo "    real_ip_recursive on;" >> $TEMP_FILE

    # Insert the content of the temporary file after the line containing "#Cloudflare"
    sed -i "/#Cloudflare/ r $TEMP_FILE" $NGINX_CONF

    # Clean up the temporary file
    rm -f $TEMP_FILE

    # Reload NGINX to apply the new configuration
    #nginx -s reload

    echo "NGINX configuration updated successfully."

else
    echo "CLOUDFLARE is not set to 1. Skipping the update."
fi