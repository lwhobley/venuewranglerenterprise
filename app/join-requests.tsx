import { Redirect } from 'expo-router';

export default function JoinRequestsScreen() {
  return <Redirect href="/(tabs)/staff" />;
}

export { RouteErrorBoundary as ErrorBoundary } from '../components/ErrorBoundary';
