import { Redirect } from 'expo-router';

export default function VerifyEmailScreen() {
  return <Redirect href="/(tabs)/home" />;
}

export { RouteErrorBoundary as ErrorBoundary } from '../../components/ErrorBoundary';
