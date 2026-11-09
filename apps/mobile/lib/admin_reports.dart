import 'package:flutter/material.dart';
import 'main.dart';

class AdminReportsScreen extends StatefulWidget {
  const AdminReportsScreen({super.key, required this.api});
  final Api api;
  @override State<AdminReportsScreen> createState()=>_AdminReportsScreenState();
}
class _AdminReportsScreenState extends State<AdminReportsScreen> {
  String filter='OPEN';
  List<dynamic> reports=[];
  String? cursor,error;
  bool busy=false;
  @override void initState(){super.initState();refresh();}
  Future<void> refresh({bool append=false}) async {
    if(busy)return;
    setState(()=>busy=true);
    try{
      final path='/admin/reports?status=$filter&limit=25'+(append && cursor!=null?'&cursor=$cursor':'');
      final result=await widget.api.call('GET',path) as Map<String,dynamic>;
      if(mounted)setState((){
        reports=append?[...reports,...(result['items'] as List<dynamic>)]:result['items'] as List<dynamic>;
        cursor=result['nextCursor'] as String?;
        error=null;
      });
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> decide(Map<String,dynamic> report,String status) async {
    final note=TextEditingController();
    try{
      final result=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(
        title:Text(status=='REVIEWED'?'Mark reviewed':'Dismiss report'),
        content:TextField(controller:note,maxLength:1000,maxLines:3,
          decoration:const InputDecoration(labelText:'Review notes (required)')),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,note.text.trim()),child:const Text('Save decision')),
        ]));
      if(result==null)return;
      if(result.length<3){
        if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Enter a review note')));
        return;
      }
      await widget.api.call('PATCH','/admin/reports/'+(report['id'] as String),{
        'status':status,'note':result,
      });
      await refresh();
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString())));
    }finally{
      await Future<void>.delayed(const Duration(milliseconds:250));note.dispose();
    }
  }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar:AppBar(title:const Text('LIVE report review'),actions:[
      IconButton(onPressed:busy?null:()=>refresh(),icon:const Icon(Icons.refresh)),
    ]),
    body:Column(children:[
      Padding(padding:const EdgeInsets.all(12),child:DropdownButton<String>(
        value:filter,isExpanded:true,items:const [
          DropdownMenuItem(value:'OPEN',child:Text('Open reports')),
          DropdownMenuItem(value:'REVIEWED',child:Text('Reviewed')),
          DropdownMenuItem(value:'DISMISSED',child:Text('Dismissed')),
        ],onChanged:(status){
          if(status==null)return;
          setState((){filter=status;cursor=null;reports=[];});
          refresh();
        })),
      if(busy)const LinearProgressIndicator(),
      if(error!=null)Padding(padding:const EdgeInsets.all(10),child:Text(error!)),
      Expanded(child:RefreshIndicator(onRefresh:()=>refresh(),child:ListView(
        children:[
          if(reports.isEmpty)const ListTile(title:Text('No reports in this view')),
          ...reports.map((value){
            final report=value as Map<String,dynamic>;
            final room=report['room'] as Map<String,dynamic>;
            return Card(margin:const EdgeInsets.all(8),child:Padding(
              padding:const EdgeInsets.all(12),child:Column(
                crossAxisAlignment:CrossAxisAlignment.start,children:[
                  Text(room['title'] as String,style:const TextStyle(fontWeight:FontWeight.bold)),
                  Text(report['reason'] as String),
                  Text('Room: '+(report['roomId'] as String)),
                  Text('Reporter: '+(report['reporterId'] as String)),
                  if(report['subjectId']!=null)Text('Subject: '+(report['subjectId'] as String)),
                  if(report['reviewNote']!=null)Text('Review: '+(report['reviewNote'] as String)),
                  if(filter=='OPEN')Wrap(spacing:8,children:[
                    FilledButton(onPressed:busy?null:()=>decide(report,'REVIEWED'),
                      child:const Text('Mark reviewed')),
                    OutlinedButton(onPressed:busy?null:()=>decide(report,'DISMISSED'),
                      child:const Text('Dismiss')),
                  ]),
                ])));
          }),
          if(cursor!=null)TextButton(onPressed:busy?null:()=>refresh(append:true),
            child:const Text('Load more'))
        ],
      ))),
    ]),
  );
}
