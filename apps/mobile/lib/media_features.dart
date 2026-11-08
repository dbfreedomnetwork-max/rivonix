import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'main.dart';

extension ImageUploads on Api {
  Future<String> uploadPhoto(XFile photo, String purpose) async {
    final bytes = await photo.readAsBytes();
    if (bytes.length > 5 * 1024 * 1024) throw Exception('Image must be under 5 MB');
    final name = photo.name.toLowerCase();
    final mime = name.endsWith('.png') ? 'png' : name.endsWith('.webp') ? 'webp' : 'jpeg';
    final req = http.MultipartRequest('POST', Uri.parse('$apiBase/uploads/image'));
    req.headers['Authorization'] = 'Bearer $token';
    req.fields['purpose'] = purpose;
    req.files.add(http.MultipartFile.fromBytes('image', bytes, filename: 'photo.$mime',
      contentType: MediaType('image', mime)));
    final response = await http.Response.fromStream(await req.send().timeout(const Duration(seconds: 30)));
    final body = jsonDecode(response.body) as Map<String, dynamic>;
    if (response.statusCode >= 400) throw Exception(body['error'] ?? 'Upload failed');
    return body['mediaId'] as String;
  }
}

class PhotoPostInput {
  const PhotoPostInput(this.text, this.image);
  final String text;
  final XFile? image;
}

Future<PhotoPostInput?> showComposePost(BuildContext context) async {
  final controller = TextEditingController();
  XFile? image;
  final result = await showDialog<PhotoPostInput>(context: context, builder: (dialogContext) =>
    StatefulBuilder(builder: (context, refresh) => AlertDialog(
      title: const Text('Create post'),
      content: SizedBox(width: 380, child: SingleChildScrollView(child: Column(mainAxisSize: MainAxisSize.min, children: [
        TextField(controller: controller, maxLines: 4, maxLength: 2000,
          decoration: const InputDecoration(hintText: 'Share something...')),
        if (image != null) Padding(padding: const EdgeInsets.all(8), child: Text('Selected: ${image!.name}')),
        OutlinedButton.icon(onPressed: () async {
          final selected = await ImagePicker().pickImage(source: ImageSource.gallery, maxWidth: 1600,
            maxHeight: 1600, imageQuality: 85);
          if (selected != null) refresh(() => image = selected);
        }, icon: const Icon(Icons.photo_library), label: const Text('Choose photo')),
      ]))),
      actions: [
        TextButton(onPressed: () => Navigator.pop(dialogContext), child: const Text('Cancel')),
        FilledButton(onPressed: () {
          if (controller.text.trim().isNotEmpty || image != null) {
            Navigator.pop(dialogContext, PhotoPostInput(controller.text.trim(), image));
          }
        }, child: const Text('Publish'))
      ],
    )));
  // Dispose after dialog transition to avoid notifying a still-mounted TextField.
  await Future<void>.delayed(const Duration(milliseconds: 250));
  controller.dispose();
  return result;
}

String? mediaUrl(dynamic value) {
  if (value is! String || !value.startsWith('/media/')) return null;
  return Uri.parse(apiBase).resolve(value).toString();
}

Widget userAvatar(String? url, {double radius = 22}) {
  final resolved = mediaUrl(url);
  return CircleAvatar(radius: radius, backgroundColor: violet,
    backgroundImage: resolved == null ? null : NetworkImage(resolved),
    child: resolved == null ? const Icon(Icons.person) : null);
}
