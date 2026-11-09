import 'dart:async';
import 'package:flutter/material.dart';
import 'package:agora_rtc_engine/agora_rtc_engine.dart';
import 'package:permission_handler/permission_handler.dart';
import 'main.dart';
import 'live_seats.dart';
import 'live_moderation.dart';
import 'rivo_economy.dart';

class LiveLobby extends StatefulWidget {
  const LiveLobby({super.key, required this.api});
  final Api api;
  @override State<LiveLobby> createState()=>_LiveLobbyState();
}
class _LiveLobbyState extends State<LiveLobby> {
  List<dynamic> rooms=[];
  String? error;
  @override void initState(){super.initState(); refresh();}
  Future<void> refresh() async {
    try {
      final result=await widget.api.call('GET','/live/rooms') as Map<String,dynamic>;
      if(mounted)setState((){rooms=result['items'] as List<dynamic>;error=null;});
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> create() async {
    final controller=TextEditingController();
    try {
      final title=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('Start LIVE'),content:TextField(controller:controller,maxLength:120,
        decoration:const InputDecoration(labelText:'Room title')),
        actions:[TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,controller.text.trim()),child:const Text('Go LIVE'))]));
      if(title==null || title.length<3)return;
      final room=await widget.api.call('POST','/live/rooms',{'title':title}) as Map<String,dynamic>;
      if(mounted)await enter(room);
    }catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));}
    finally{await Future<void>.delayed(const Duration(milliseconds:250));controller.dispose();}
  }
  Future<void> enter(Map<String,dynamic> room) async {
    await Navigator.push(context,MaterialPageRoute<void>(builder:(_)=>LiveRoomScreen(api:widget.api,room:room)));
    if(mounted)await refresh();
  }
  @override Widget build(BuildContext context)=>Column(children:[
    Padding(padding:const EdgeInsets.all(12),child:Row(children:[
      const Expanded(child:Text('LIVE now',style:TextStyle(fontSize:22,fontWeight:FontWeight.bold))),
      IconButton(onPressed:refresh,icon:const Icon(Icons.refresh)),
      FilledButton.icon(onPressed:create,icon:const Icon(Icons.videocam),label:const Text('Go LIVE')),
    ])),
    if(error!=null)Text(error!),
    Expanded(child:RefreshIndicator(onRefresh:refresh,child:rooms.isEmpty?
      ListView(children:const [SizedBox(height:100),Center(child:Text('No LIVE rooms yet'))]):
      ListView.builder(itemCount:rooms.length,itemBuilder:(ctx,i){
        final room=rooms[i] as Map<String,dynamic>;
        final host=room['host'] as Map<String,dynamic>;
        return ListTile(leading:const Icon(Icons.wifi_tethering,color:Colors.pinkAccent),
          title:Text(room['title'] as String),subtitle:Text('@'+(host['username'] as String)),
          trailing:const Icon(Icons.play_arrow),onTap:()=>enter(room));
      }))),
  ]);
}

class LiveRoomScreen extends StatefulWidget {
  const LiveRoomScreen({super.key,required this.api,required this.room});
  final Api api;
  final Map<String,dynamic> room;
  @override State<LiveRoomScreen> createState()=>_LiveRoomScreenState();
}
class _LiveRoomScreenState extends State<LiveRoomScreen> {
  RtcEngine? rtc;
  Timer? timer;
  Timer? stateTimer;
  bool closing=false;
  final Set<int> remoteUids={};
  bool host=false,guest=false,joined=false,micMuted=false,cameraMuted=false;
  String? currentUserId;
  String? error;
  List<dynamic> messages=[];
  final message=TextEditingController();
  String get id=>widget.room['id'] as String;
  @override void initState(){super.initState();connect();}
  Future<Map<String,dynamic>> session() async =>
    await widget.api.call('POST','/live/rooms/'+id+'/join') as Map<String,dynamic>;
  Future<void> connect() async {
    try {
      final credentials=await session();
      host=credentials['role']=='host';
      guest=credentials['role']=='guest';
      final who=await widget.api.call('GET','/me') as Map<String,dynamic>;
      currentUserId=who['id'] as String;
      if(host || guest){
        if(!(await Permission.camera.request()).isGranted || !(await Permission.microphone.request()).isGranted){
          throw Exception('Camera and microphone permissions required');
        }
      }
      final engine=createAgoraRtcEngine();
      rtc=engine;
      await engine.initialize(RtcEngineContext(
        appId:credentials['appId'] as String,
        channelProfile:ChannelProfileType.channelProfileLiveBroadcasting,
      ));
      await engine.enableVideo();
      engine.registerEventHandler(RtcEngineEventHandler(
        onJoinChannelSuccess:(_,__) {if(mounted)setState(()=>joined=true);},
        onUserJoined:(_,uid,__) {if(mounted)setState(()=>remoteUids.add(uid));},
        onUserOffline:(_,uid,__) {if(mounted)setState(()=>remoteUids.remove(uid));},
        onTokenPrivilegeWillExpire:(_,__) async {
          try{final fresh=await session();await engine.renewToken(fresh['token'] as String);}
          catch(_){if(mounted)setState(()=>error='RTC token renewal failed');}
        },
        onError:(_,msg){if(mounted)setState(()=>error=msg);},
      ));
      if(host || guest)await engine.startPreview();
      await engine.joinChannel(
        token:credentials['token'] as String,channelId:credentials['channel'] as String,
        uid:credentials['uid'] as int,
        options:ChannelMediaOptions(
          clientRoleType:(host || guest)?ClientRoleType.clientRoleBroadcaster:ClientRoleType.clientRoleAudience,
          publishMicrophoneTrack:(host || guest),publishCameraTrack:(host || guest),
          autoSubscribeAudio:true,autoSubscribeVideo:true,
        ),
      );
      await loadChat();
      timer=Timer.periodic(const Duration(seconds:4),(_){loadChat();});
      stateTimer=Timer.periodic(const Duration(seconds:5),(_){checkState();});
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> syncSeatRole() async {
    if(host || rtc==null || !joined)return;
    try {
      final updated=await session();
      final approved=updated['role']=='guest';
      await rtc!.renewToken(updated['token'] as String);
      if(approved!=guest) {
        if(approved){
          final camera=await Permission.camera.request();
          final microphone=await Permission.microphone.request();
          if(!camera.isGranted || !microphone.isGranted) {
            if(mounted)ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content:Text('Camera and microphone permission needed for guest seat')));
            return;
          }
          await rtc!.setClientRole(role:ClientRoleType.clientRoleBroadcaster);
          await rtc!.startPreview();
          await rtc!.muteLocalAudioStream(false);
          await rtc!.muteLocalVideoStream(false);
        }else{
          await rtc!.muteLocalAudioStream(true);
          await rtc!.muteLocalVideoStream(true);
          await rtc!.setClientRole(role:ClientRoleType.clientRoleAudience);
          await rtc!.stopPreview();
        }
        if(mounted)setState(()=>guest=approved);
      }
    }catch(e){if(mounted)setState(()=>error='Guest seat sync failed: '+e.toString());}
  }
  Future<void> checkState() async {
    if(closing || !joined)return;
    try {
      final state=await widget.api.call('GET','/live/rooms/'+id+'/state') as Map<String,dynamic>;
      if(state['status']=='ENDED' || state['banned']==true){
        closing=true;
        await rtc?.muteLocalAudioStream(true);
        await rtc?.muteLocalVideoStream(true);
        await rtc?.leaveChannel();
        if(mounted){
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(
            state['banned']==true?'You were removed from this room':'LIVE has ended')));
          Navigator.of(context).pop();
        }
      }
    }catch(_) {
      // A network error is not evidence of a ban or completed broadcast.
    }
  }
  Future<void> loadChat() async {
    try{
      final data=await widget.api.call('GET','/live/rooms/'+id+'/messages') as Map<String,dynamic>;
      if(mounted)setState(()=>messages=data['items'] as List<dynamic>);
    }catch(_){}
  }
  Future<void> send() async {
    final text=message.text.trim();
    if(text.isEmpty)return;
    try{
      await widget.api.call('POST','/live/rooms/'+id+'/messages',{'text':text});
      message.clear();await loadChat();
    }catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));}
  }
  Future<void> leave() async {
    if(host){
      try{await widget.api.call('POST','/live/rooms/'+id+'/end');}
      catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));return;}
    }
    if(mounted)Navigator.pop(context);
  }
  @override void dispose(){
    timer?.cancel();stateTimer?.cancel();message.dispose();
    final engine=rtc;
    if(engine!=null){engine.leaveChannel().then((_)=>engine.release());}
    super.dispose();
  }
  Widget video(){
    final engine=rtc;
    if(engine==null || !joined)return const Center(child:CircularProgressIndicator());
    final streams=<Widget>[];
    if(host || guest){
      streams.add(AgoraVideoView(controller:VideoViewController(
        rtcEngine:engine,canvas:const VideoCanvas(uid:0))));
    }
    for(final uid in remoteUids.take(9-(host||guest?1:0))){
      streams.add(AgoraVideoView(controller:VideoViewController.remote(
        rtcEngine:engine,canvas:VideoCanvas(uid:uid),
        connection:RtcConnection(channelId:widget.room['channel'] as String))));
    }
    if(streams.isEmpty)return const Center(child:Text('Waiting for broadcaster...'));
    final count=streams.length;
    final columns=count<=1?1:count<=4?2:3;
    return GridView.count(crossAxisCount:columns,childAspectRatio:0.72,
      children:streams.map((view)=>Padding(padding:const EdgeInsets.all(2),
        child:ClipRRect(borderRadius:BorderRadius.circular(8),child:view))).toList());
  }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:Text(widget.room['title'] as String),
      actions:[TextButton(onPressed:leave,child:Text(host?'End LIVE':'Leave'))]),
    body:SafeArea(child:Column(children:[
      Expanded(flex:5,child:ColoredBox(color:Colors.black,child:Stack(fit:StackFit.expand,children:[
        video(),if(error!=null)Positioned(top:8,left:8,right:8,
          child:Text(error!,style:const TextStyle(color:Colors.redAccent))),
      ]))),
      if(host || guest)Row(mainAxisAlignment:MainAxisAlignment.spaceEvenly,children:[
        IconButton(onPressed:() async {
          await rtc?.muteLocalAudioStream(!micMuted);
          if(mounted)setState(()=>micMuted=!micMuted);
        },icon:Icon(micMuted?Icons.mic_off:Icons.mic)),
        IconButton(onPressed:() async {
          await rtc?.muteLocalVideoStream(!cameraMuted);
          if(mounted)setState(()=>cameraMuted=!cameraMuted);
        },icon:Icon(cameraMuted?Icons.videocam_off:Icons.videocam)),
        IconButton(onPressed:()=>rtc?.switchCamera(),icon:const Icon(Icons.flip_camera_android)),
      ]),
      if(currentUserId!=null)LiveSeatsPanel(api:widget.api,roomId:id,host:host,
        currentUserId:currentUserId!,onSeatChanged:syncSeatRole),
      LiveModerationPanel(api:widget.api,roomId:id,isHost:host),
      RivoLiveGifts(api:widget.api,roomId:id,hostId:widget.room['hostId'] as String),
      const Padding(padding:EdgeInsets.all(6),child:Text('Chat (refreshes every 4 seconds)')),
      Expanded(flex:2,child:ListView.builder(itemCount:messages.length,itemBuilder:(ctx,i){
        final m=messages[i] as Map<String,dynamic>;final u=m['user'] as Map<String,dynamic>;
        return ListTile(dense:true,title:Text('@'+(u['username'] as String)+': '+(m['text'] as String)));
      })),
      Row(children:[
        Expanded(child:TextField(controller:message,maxLength:250,decoration:
          const InputDecoration(hintText:'Send message',counterText:''))),
        IconButton(onPressed:send,icon:const Icon(Icons.send)),
      ]),
    ])),
  );
}
