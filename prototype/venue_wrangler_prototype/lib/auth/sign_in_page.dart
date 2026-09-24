import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'auth.dart';

class SignInPage extends ConsumerStatefulWidget {
  const SignInPage({super.key});

  @override
  ConsumerState<SignInPage> createState() => _SignInPageState();
}

class _SignInPageState extends ConsumerState<SignInPage> {
  final _organization = TextEditingController();
  List<AuthProviderOption>? _providers;
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _organization.dispose();
    super.dispose();
  }

  Future<void> _continue() async {
    final slug = _organization.text.trim().toLowerCase();
    if (!RegExp(r'^[a-z0-9][a-z0-9-]{1,62}$').hasMatch(slug)) {
      setState(() => _error = 'Enter your organization access code.');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
      _providers = null;
    });
    try {
      final providers =
          await ref.read(authRepositoryProvider).providersFor(slug);
      if (!mounted) return;
      setState(() => _providers = providers);
      if (providers.isEmpty) {
        setState(() => _error =
            'No sign-in provider is configured for this organization.');
      }
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'We couldn’t find sign-in options. Check the code and try again.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _signIn(AuthProviderOption provider) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authSessionProvider.notifier).signIn(
            _organization.text.trim().toLowerCase(),
            provider,
          );
    } catch (_) {
      if (mounted) {
        setState(() => _error =
            'Sign-in didn’t complete. Try again or contact your organization administrator.');
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: SingleChildScrollView(
              padding: const EdgeInsets.all(28),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.stadium_outlined, size: 54, color: colors.primary),
                  const SizedBox(height: 22),
                  Text('Venue Wrangler',
                      textAlign: TextAlign.center,
                      style: Theme.of(context)
                          .textTheme
                          .headlineMedium
                          ?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 8),
                  Text('Sign in through your organization',
                      textAlign: TextAlign.center,
                      style: Theme.of(context).textTheme.bodyLarge),
                  const SizedBox(height: 32),
                  TextField(
                    controller: _organization,
                    textInputAction: TextInputAction.go,
                    autocorrect: false,
                    enableSuggestions: false,
                    onSubmitted: (_) => _continue(),
                    decoration: const InputDecoration(
                      labelText: 'Organization access code',
                      hintText: 'For example, harbor-city-events',
                      border: OutlineInputBorder(),
                    ),
                  ),
                  const SizedBox(height: 12),
                  FilledButton(
                    onPressed: _loading ? null : _continue,
                    child: _loading && _providers == null
                        ? const SizedBox.square(
                            dimension: 20,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Text('Continue'),
                  ),
                  if (_providers != null) ...[
                    const SizedBox(height: 26),
                    Text('Choose your sign-in provider',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700)),
                    const SizedBox(height: 12),
                    for (final provider in _providers!) ...[
                      OutlinedButton.icon(
                        onPressed:
                            _loading || kIsWeb ? null : () => _signIn(provider),
                        icon: Icon(provider.id == 'entra'
                            ? Icons.window
                            : Icons.verified_user_outlined),
                        label: Text('Continue with ${provider.name}'),
                      ),
                      const SizedBox(height: 8),
                    ],
                    if (kIsWeb)
                      Text(
                          'Federated sign-in is currently configured for the iOS and Android apps.',
                          style: Theme.of(context).textTheme.bodySmall),
                  ],
                  if (_error != null) ...[
                    const SizedBox(height: 16),
                    Text(_error!,
                        style: TextStyle(color: colors.error),
                        textAlign: TextAlign.center),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
