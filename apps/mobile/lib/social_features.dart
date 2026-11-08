import 'package:flutter/material.dart';
import 'main.dart';

class ExploreScreen extends StatefulWidget {
  const ExploreScreen({super.key, required this.api});
  final Api api;
  @override State<ExploreScreen> createState() => _ExploreScreenState();
}
class _ExploreScreenState extends State<ExploreScreen> {
  final query = TextEditingController();
  List<dynamic> users = [];
  bool busy = false;
  String? error;
  @override void dispose() { query.dispose(); super.dispose(); }
  Future<void> search() async {
    if (query.text.trim().isEmpty) { setState(() { users = []; error = null; }); return; }
    setState(() { busy = true; error = null; });
    try {
      final data = await widget.api.call('GET', '/users/search?q=${Uri.encodeQueryComponent(query.text.trim())}') as Map<String, dynamic>;
      if (mounted) setState(() => users = data['items'] as List<dynamic>);
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> follow(Map<String, dynamic> user) async {
    try {
      await widget.api.call('POST', '/users/${user['id']}/follow');
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Following @${user['username']}')));
    } catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e'))); }
  }
  @override Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.all(16), child: Column(children: [
      TextField(controller: query, textInputAction: TextInputAction.search,
        onSubmitted: (_) => search(),
        decoration: InputDecoration(labelText: 'Find creators', prefixIcon: const Icon(Icons.search),
          suffixIcon: IconButton(icon: const Icon(Icons.arrow_forward), onPressed: search))),
      if (busy) const LinearProgressIndicator(),
      if (error != null) Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
      Expanded(child: users.isEmpty
        ? const Center(child: Text('Search by username or display name'))
        : ListView.builder(itemCount: users.length, itemBuilder: (context, i) {
            final user = users[i] as Map<String, dynamic>;
            return ListTile(leading: const CircleAvatar(child: Icon(Icons.person)),
              title: Text(user['displayName'] as String), subtitle: Text('@${user['username']}'),
              trailing: FilledButton(onPressed: () => follow(user), child: const Text('Follow')));
          })),
    ]));
}

class CommentsScreen extends StatefulWidget {
  const CommentsScreen({super.key, required this.api, required this.postId});
  final Api api;
  final String postId;
  @override State<CommentsScreen> createState() => _CommentsScreenState();
}
class _CommentsScreenState extends State<CommentsScreen> {
  final input = TextEditingController();
  List<dynamic> comments = [];
  bool busy = false;
  String? error;
  @override void initState() { super.initState(); load(); }
  @override void dispose() { input.dispose(); super.dispose(); }
  Future<void> load() async {
    try {
      final result = await widget.api.call('GET', '/posts/${widget.postId}/comments') as Map<String, dynamic>;
      if (mounted) setState(() { comments = result['items'] as List<dynamic>; error = null; });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
  }
  Future<void> submit() async {
    final text = input.text.trim();
    if (text.isEmpty || busy) return;
    setState(() => busy = true);
    try {
      await widget.api.call('POST', '/posts/${widget.postId}/comments', {'text': text});
      input.clear();
      await load();
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Comments')),
    body: SafeArea(child: Column(children: [
      if (error != null) Padding(padding: const EdgeInsets.all(12), child: Text(error!)),
      Expanded(child: RefreshIndicator(onRefresh: load, child: ListView.builder(
        itemCount: comments.length, itemBuilder: (context, i) {
          final comment = comments[i] as Map<String, dynamic>;
          final author = comment['author'] as Map<String, dynamic>;
          return ListTile(title: Text('@${author['username']}'),
            subtitle: Text(comment['text'] as String));
        }))),
      Padding(padding: const EdgeInsets.all(12), child: Row(children: [
        Expanded(child: TextField(controller: input, maxLength: 1000,
          decoration: const InputDecoration(hintText: 'Write a comment'))),
        IconButton(onPressed: busy ? null : submit, icon: const Icon(Icons.send)),
      ])),
    ])));
}

class EditProfileScreen extends StatefulWidget {
  const EditProfileScreen({super.key, required this.api, required this.profile});
  final Api api;
  final Map<String, dynamic> profile;
  @override State<EditProfileScreen> createState() => _EditProfileScreenState();
}
class _EditProfileScreenState extends State<EditProfileScreen> {
  late final TextEditingController name = TextEditingController(text: widget.profile['displayName'] as String? ?? '');
  late final TextEditingController bio = TextEditingController(text: widget.profile['bio'] as String? ?? '');
  bool saving = false;
  String? error;
  @override void dispose() { name.dispose(); bio.dispose(); super.dispose(); }
  Future<void> save() async {
    setState(() { saving = true; error = null; });
    try {
      await widget.api.call('PATCH', '/me', {'displayName': name.text.trim(), 'bio': bio.text.trim()});
      if (mounted) Navigator.of(context).pop(true);
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => saving = false); }
  }
  @override Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: const Text('Edit profile')),
    body: ListView(padding: const EdgeInsets.all(20), children: [
      TextField(controller: name, maxLength: 80, decoration: const InputDecoration(labelText: 'Display name')),
      TextField(controller: bio, maxLength: 240, maxLines: 4, decoration: const InputDecoration(labelText: 'Bio')),
      if (error != null) Text(error!),
      FilledButton(onPressed: saving ? null : save, child: Text(saving ? 'Saving...' : 'Save changes')),
    ]));
}
