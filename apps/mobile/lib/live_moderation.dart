import 'package:flutter/material.dart';
import 'main.dart';

class LiveModerationPanel extends StatefulWidget {
  const LiveModerationPanel({super.key,required this.api,required this.roomId,required this.isHost});
  final Api api;
  final String roomId;
  final bool isHost;
  @override State<LiveModerationPanel> createState()=>_LiveModerationPanelState();
}
class _LiveModerationPanelState extends State<LiveModerationPanel> {
  List<dynamic> viewers=[];
  String? error;
  bool busy=false;
  String get route=>'/live/rooms/'+widget.roomId;
  Future<void> refresh() async {
    if(!widget.isHost)return;
    try {
      final data=await widget.api.call('GET',route+'/viewers') as Map<String,dynamic>;
      if(mounted)setState((){viewers=data['items'] as List<dynamic>;error=null;});
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> removeViewer(String id) async {
    if(busy)return;
    final approved=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('Remove viewer?'),
      content:const Text('This account will be blocked from rejoining this room.'),
      actions:[
        TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('Cancel')),
        FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('Remove'))
      ]));
    if(approved!=true)return;
    setState(()=>busy=true);
    try {
      await widget.api.call('POST',route+'/bans',{'userId':id});
      await refresh();
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> report() async {
    final controller=TextEditingController();
    try {
      final reason=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('Report LIVE room'),
        content:TextField(controller:controller,maxLength:250,maxLines:3,
          decoration:const InputDecoration(labelText:'Describe the concern')),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,controller.text.trim()),child:const Text('Submit'))
        ]));
      if(reason==null || reason.length<5)return;
      await widget.api.call('POST',route+'/reports',{'reason':reason});
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content:Text('Report saved for review')));
    }catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content:Text(e.toString())));}
    finally{await Future<void>.delayed(const Duration(milliseconds:250));controller.dispose();}
  }
  @override Widget build(BuildContext context)=>ExpansionTile(
    title:const Text('Safety & moderation'),
    onExpansionChanged:(open){if(open)refresh();},
    children:[
      if(error!=null)Text(error!),
      if(!widget.isHost)OutlinedButton.icon(onPressed:report,
        icon:const Icon(Icons.flag_outlined),label:const Text('Report this LIVE')),
      if(widget.isHost)...[
        OutlinedButton.icon(onPressed:refresh,icon:const Icon(Icons.refresh),
          label:const Text('Refresh viewers')),
        SizedBox(height:170,child:ListView.builder(itemCount:viewers.length,itemBuilder:(ctx,i){
          final viewer=viewers[i] as Map<String,dynamic>;
          final user=viewer['user'] as Map<String,dynamic>;
          return ListTile(title:Text('@'+(user['username'] as String)),
            trailing:IconButton(tooltip:'Remove viewer',onPressed:busy?null:()=>
              removeViewer(viewer['userId'] as String),icon:const Icon(Icons.person_off_outlined)));
        })),
      ]
    ]);
}
