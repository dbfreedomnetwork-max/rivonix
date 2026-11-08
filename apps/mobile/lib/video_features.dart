import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:video_player/video_player.dart';
import 'main.dart';
import 'media_features.dart';
import 'social_features.dart';

extension VideoUploads on Api {
  Future<String> uploadVideo(XFile video) async {
    if (!video.name.toLowerCase().endsWith('.mp4')) throw Exception('Select MP4 video');
    if (await video.length() > 25 * 1024 * 1024) throw Exception('Maximum video size is 25 MB');
    final req = http.MultipartRequest('POST', Uri.parse(apiBase + '/uploads/video'));
    req.headers['Authorization'] = 'Bearer ' + (token ?? '');
    req.files.add(await http.MultipartFile.fromPath('video', video.path,
        filename: 'upload.mp4', contentType: MediaType('video', 'mp4')));
    final response = await http.Response.fromStream(await req.send().timeout(const Duration(minutes:2)));
    final data = jsonDecode(response.body) as Map<String,dynamic>;
    if(response.statusCode >= 400) throw Exception(data['error'] ?? 'Upload failed');
    return data['mediaId'] as String;
  }
}

Future<bool> publishReel(BuildContext context, Api api) async {
  final video = await ImagePicker().pickVideo(source: ImageSource.gallery);
  if(video == null || !context.mounted) return false;
  final caption = TextEditingController();
  try {
    final text = await showDialog<String>(context: context, builder: (ctx) =>
      AlertDialog(title: const Text('New Reel'), content: Column(mainAxisSize:MainAxisSize.min,children:[
        Text(video.name, maxLines:2, overflow:TextOverflow.ellipsis),
        TextField(controller:caption,maxLength:2000,maxLines:3,decoration:const InputDecoration(labelText:'Caption'))
      ]), actions:[
        TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,caption.text.trim()),child:const Text('Publish'))
      ]));
    if(text == null) return false;
    final id = await api.uploadVideo(video);
    await api.call('POST','/posts',{'text':text,'videoMediaId':id});
    if(context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Reel published')));
    return true;
  } catch(e) {
    if(context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));
    return false;
  } finally {
    caption.dispose();
  }
}

class ReelsScreen extends StatefulWidget {
  const ReelsScreen({super.key,required this.api});
  final Api api;
  @override State<ReelsScreen> createState()=>_ReelsScreenState();
}
class _ReelsScreenState extends State<ReelsScreen> {
  final pager=PageController();
  List<dynamic> reels=[];
  int active=0;
  bool busy=true;
  String? error;
  String? cursor;
  @override void initState(){super.initState();refresh();}
  @override void dispose(){pager.dispose();super.dispose();}
  Future<void> refresh() async {
    setState((){busy=true;error=null;});
    try {
      final result=await widget.api.call('GET','/reels') as Map<String,dynamic>;
      if(mounted)setState((){reels=result['items'] as List<dynamic>;cursor=result['nextCursor'] as String?;active=0;});
    } catch(e) {if(mounted)setState(()=>error=e.toString());}
    finally {if(mounted)setState(()=>busy=false);}
  }
  Future<void> loadMore() async {
    final next=cursor;
    if(next==null)return;
    cursor=null;
    try {
      final result=await widget.api.call('GET','/reels?cursor='+Uri.encodeQueryComponent(next)) as Map<String,dynamic>;
      if(mounted)setState((){reels.addAll(result['items'] as List<dynamic>);cursor=result['nextCursor'] as String?;});
    } catch(_) {cursor=next;}
  }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:const Text('Reels'),actions:[
      IconButton(onPressed:refresh,icon:const Icon(Icons.refresh)),
      IconButton(onPressed:() async {if(await publishReel(context,widget.api) && mounted)await refresh();},icon:const Icon(Icons.add_circle_outline))
    ]),
    body:busy?const Center(child:CircularProgressIndicator()):
      error!=null?Center(child:Text(error!)):
      reels.isEmpty?Center(child:FilledButton(onPressed:() async {if(await publishReel(context,widget.api) && mounted)await refresh();},child:const Text('Upload first Reel'))):
      PageView.builder(controller:pager,scrollDirection:Axis.vertical,itemCount:reels.length,
        onPageChanged:(i){setState(()=>active=i);if(i>=reels.length-3)loadMore();},
        itemBuilder:(ctx,i){final reel=reels[i] as Map<String,dynamic>;
          return ReelPlayer(key:ValueKey(reel['id']),reel:reel,api:widget.api,active:i==active);}
      )
  );
}
class ReelPlayer extends StatefulWidget {
  const ReelPlayer({super.key,required this.reel,required this.api,required this.active});
  final Map<String,dynamic> reel;
  final Api api;
  final bool active;
  @override State<ReelPlayer> createState()=>_ReelPlayerState();
}
class _ReelPlayerState extends State<ReelPlayer> {
  VideoPlayerController? player;
  bool ready=false;
  String? error;
  @override void initState(){super.initState();start();}
  Future<void> start() async {
    final url=mediaUrl(widget.reel['videoUrl']);
    if(url==null){setState(()=>error='Invalid media URL');return;}
    final p=VideoPlayerController.networkUrl(Uri.parse(url));
    player=p;
    try {
      await p.initialize();
      if(!mounted || player!=p)return;
      await p.setLooping(true);
      if(widget.active)await p.play();
      if(mounted)setState(()=>ready=true);
    } catch(_) {if(mounted)setState(()=>error='Unable to play video');}
  }
  @override void didUpdateWidget(covariant ReelPlayer old) {
    super.didUpdateWidget(old);
    if(old.active!=widget.active && ready){
      if(widget.active){player?.play();}else{player?.pause();}
    }
  }
  @override void dispose(){player?.dispose();super.dispose();}
  Future<void> like() async {
    try {await widget.api.call('POST','/posts/'+(widget.reel['id'] as String)+'/likes');
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Liked')));
    } catch(e) {if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));}
  }
  @override Widget build(BuildContext context){
    final author=widget.reel['author'] as Map<String,dynamic>;
    final counts=widget.reel['_count'] as Map<String,dynamic>;
    return Stack(fit:StackFit.expand,children:[
      ColoredBox(color:Colors.black,child:Center(child:error!=null?Text(error!):
        !ready?const CircularProgressIndicator():
        GestureDetector(onTap:(){if(player!.value.isPlaying){player!.pause();}else{player!.play();}setState((){});},
          child:AspectRatio(aspectRatio:player!.value.aspectRatio,child:VideoPlayer(player!))))),
      Positioned(left:16,bottom:30,right:90,child:Column(crossAxisAlignment:CrossAxisAlignment.start,mainAxisSize:MainAxisSize.min,children:[
        Text('@'+(author['username'] as String),style:const TextStyle(fontWeight:FontWeight.bold)),
        Text(widget.reel['text'] as String)
      ])),
      Positioned(right:8,bottom:30,child:Column(children:[
        IconButton(onPressed:like,icon:const Icon(Icons.favorite_border)),
        Text(counts['likes'].toString()),
        IconButton(onPressed:()=>Navigator.push(context,MaterialPageRoute<void>(
          builder:(_)=>CommentsScreen(api:widget.api,postId:widget.reel['id'] as String))),icon:const Icon(Icons.mode_comment_outlined)),
        Text(counts['comments'].toString()),
        IconButton(onPressed:(){if(player?.value.isPlaying??false){player?.pause();}else{player?.play();}setState((){});},
          icon:Icon((player?.value.isPlaying??false)?Icons.pause:Icons.play_arrow)),
      ]))
    ]);
  }
}
