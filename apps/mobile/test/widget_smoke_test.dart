import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rivonix/main.dart';

void main() {
  testWidgets('Rivonix placeholder screen renders a title and explanation', (tester) async {
    await tester.pumpWidget(const MaterialApp(
      home: Scaffold(
        body: PlaceholderScreen(
          icon: Icons.notifications,
          title: 'Notifications',
          subtitle: 'Coming soon',
        ),
      ),
    ));
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Coming soon'), findsOneWidget);
    expect(find.byIcon(Icons.notifications), findsOneWidget);
  });
}
