module.exports = {
  apps: [
    {
      name: 'agri-admin',
      cwd: './artifacts/agri-admin',
      script: 'pnpm',
      args: 'run dev',
      env: {
        PORT: '8080',
        BASE_PATH: '/',
        NODE_ENV: 'development',
      },
    },
    {
      name: 'api-server',
      cwd: './artifacts/api-server',
      script: 'pnpm',
      args: 'run dev',
      env: {
        PORT: '8081',
        NODE_ENV: 'development',
        MONGODB_URI: 'mongodb+srv://sairajkoyande_db_user:5QlrqFxJrJmM9rR4@cluster0.akmevxg.mongodb.net/?appName=Cluster0',
        MONGODB_DB: 'apnaapp',
        DATALAB_API_KEY: 'Zgtv3ZTMRajX5sv5v9EqD81nsdUH0rfPwlWJd3SorTI',
      },
    },
  ],
};
