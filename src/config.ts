function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Environment variable ${name} is required, see .env.example`);
  return value;
}

export const config = {
  get apiUrl() { return required('API_URL').replace(/\/$/, ''); },
  get userPoolId() { return required('COGNITO_USER_POOL_ID'); },
  get region() { return process.env.AWS_REGION ?? 'eu-north-1'; },
};
