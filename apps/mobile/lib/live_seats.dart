import 'dart:async';
import 'package:flutter/material.dart';
import 'main.dart';

/// Polling management UI. The server remains the authority for all mutations.
class LiveSeatsPanel extends StatefulWidget {
  const LiveSeatsPanel({super.key,required this.api,required this.roomId,
    required this.host,required this.currentUserId,required this.onSeatChanged});
  final Api api;
  final String roomId;
  final bool host;
  final String currentUserId;
  final Future<void> Function() onSeatChanged;
  @override State<LiveSeatsPanel> createState()=>_LiveSeatsPanelState();
}
class _LiveSeatsPanelState extends State<LiveSeatsPanel> {
  Timer? ticker;
  List<dynamic> seats=[];
  String? error;
  bool busy=false;
  @override void initState() {
    super.initState(); refresh();
    ticker=Timer.periodic(const Duration(seconds:5),(_)=>refresh());
  }
  @override void dispose(){ticker?.cancel();super.dispose();}
  Future<void> refresh() async {
    try {
      final data=await widget.api.call('GET','/live/rooms/'+widget.roomId+'/seats') as Map<String,dynamic>;
      if(mounted)setState((){seats=data['seats'] as List<dynamic>;error=null;});
    } catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> action(String method,String endpoint,[Map<String,dynamic>? body]) async {
    if(busy)return;
    setState(()=>busy=true);
    try {
      await widget.api.call(method,'/live/rooms/'+widget.roomId+endpoint,body);
      await refresh();
      await widget.onSeatChanged();
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));
    }finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> invite() async {
    final controller=TextEditingController();
    try {
      final id=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('Invite joined viewer'),
        content:TextField(controller:controller,
          decoration:const InputDecoration(labelText:'Viewer account ID')),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,controller.text.trim()),child:const Text('Invite'))
        ]));
      if(id!=null && id.isNotEmpty)await action('POST','/seats/invite',{'userId':id});
    }finally{
      await Future<void>.delayed(const Duration(milliseconds:250));
      controller.dispose();
    }
  }
  @override Widget build(BuildContext context) {
    final mine=seats.where((value)=>(value as Map<String,dynamic>)['userId']==widget.currentUserId).toList();
    final myStatus=mine.isEmpty?null:(mine.first as Map<String,dynamic>)['status'] as String?;
    final active=seats.where((value)=>(value as Map<String,dynamic>)['status']=='ACTIVE').length;
    return ExpansionTile(title:Text('Guest seats ($active/8)'),children:[
      if(error!=null)Padding(padding:const EdgeInsets.all(8),child:Text(error!)),
      if(widget.host)OutlinedButton.icon(onPressed:busy?null:invite,
        icon:const Icon(Icons.person_add),label:const Text('Invite joined viewer')),
      if(!widget.host && myStatus!='ACTIVE')...[
        if(myStatus=='INVITED')FilledButton(onPressed:busy?null:()=>
          action('POST','/seats/accept'),child:const Text('Accept guest invitation')),
        if(myStatus!='INVITED' && myStatus!='REQUESTED')OutlinedButton(
          onPressed:busy?null:()=>action('POST','/seats/request'),
          child:const Text('Request guest seat')),
        if(myStatus=='REQUESTED')const Text('Waiting for host approval'),
      ],
      if(!widget.host && (myStatus=='ACTIVE'||myStatus=='REQUESTED'||myStatus=='INVITED'))
        TextButton(onPressed:busy?null:()=>action('DELETE','/seats/'+widget.currentUserId),
          child:const Text('Leave or cancel seat')),
      ...seats.map((value){
        final seat=value as Map<String,dynamic>;
        final user=seat['user'] as Map<String,dynamic>;
        final status=seat['status'] as String;
        final userId=seat['userId'] as String;
        return ListTile(
          title:Text('@'+(user['username'] as String)),
          subtitle:Text(status+(seat['seatNumber']==null?'':' • seat '+seat['seatNumber'].toString())),
          trailing:widget.host && userId!=widget.currentUserId
            ? Row(mainAxisSize:MainAxisSize.min,children:[
              if(status=='REQUESTED')IconButton(
                tooltip:'Approve',onPressed:busy?null:()=>action('POST','/seats/'+userId+'/approve'),
                icon:const Icon(Icons.check_circle_outline)),
              IconButton(tooltip:'Remove or reject',onPressed:busy?null:()=>
                action('DELETE','/seats/'+userId),icon:const Icon(Icons.person_remove_outlined))
            ]) : null,
        );
      }),
    ]);
  }
}
