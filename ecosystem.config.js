module.exports = {
  apps: [
    {
      name: "rproxy",
      script: "/opt/rproxy/scripts/start-app.sh",
      interpreter: "/bin/bash",
      env_file: "/opt/rproxy/apps/web/.env.local",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      out_file: "/var/log/rproxy/app.log",
      error_file: "/var/log/rproxy/error.log",
      time: true,
    },
  ],
};
