import 'package:flutter/material.dart';
import 'main.dart';

/// Development-only virtual points. No coin purchases, real-money balances,
/// withdrawal, gift conversion, or payouts are supported.
class RivoDemoHub extends StatefulWidget {
  const RivoDemoHub({super.key,required this.api});
  final Api api;
  @override State<RivoDemoHub> createState()=>_RivoDemoHubState();
}
class _RivoDemoHubState extends State<RivoDemoHub> {
  Map<String,dynamic>? wallet;
  Map<String,dynamic>? agencies;
  List<dynamic> ledger=[];
  String? error;
  bool busy=false;

  @override void initState(){super.initState();refresh();}
  Future<void> refresh() async {
    try {
      final values=await Future.wait([
        widget.api.call('GET','/rivo/wallet'),
        widget.api.call('GET','/rivo/ledger'),
        widget.api.call('GET','/rivo/agencies/mine')
      ]);
      if(mounted)setState(() {
        wallet=values[0] as Map<String,dynamic>;
        ledger=(values[1] as Map<String,dynamic>)['items'] as List<dynamic>;
        agencies=values[2] as Map<String,dynamic>;
        error=null;
      });
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> credit() async {
    if(busy)return;
    setState(()=>busy=true);
    try{
      await widget.api.call('POST','/rivo/demo-credit');
      await refresh();
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> createAgency() async {
    final name=TextEditingController();
    try{
      final title=await showDialog<String>(context:context,builder:(ctx)=>AlertDialog(
        title:const Text('Create demo agency'),
        content:TextField(controller:name,maxLength:100,
          decoration:const InputDecoration(labelText:'Agency name')),
        actions:[
          TextButton(onPressed:()=>Navigator.pop(ctx),child:const Text('Cancel')),
          FilledButton(onPressed:()=>Navigator.pop(ctx,name.text.trim()),child:const Text('Create')),
        ]));
      if(title==null || title.length<3)return;
      await widget.api.call('POST','/rivo/agencies',{'name':title});
      await refresh();
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{await Future<void>.delayed(const Duration(milliseconds:250));name.dispose();}
  }
  Future<void> accept() async {
    try{
      await widget.api.call('POST','/rivo/agencies/invitations/accept');
      await refresh();
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  @override Widget build(BuildContext context){
    final m=agencies?['membership'] as Map<String,dynamic>?;
    final owned=agencies?['owned'] as List<dynamic>? ?? [];
    return Scaffold(appBar:AppBar(title:const Text('Rivo Creator Center')),
      body:ListView(padding:const EdgeInsets.all(16),children:[
        const Text('PREVIEW ONLY • No real money, purchases or cash-outs',
          style:TextStyle(color:Colors.orangeAccent,fontWeight:FontWeight.bold)),
        if(error!=null)Padding(padding:const EdgeInsets.all(8),child:Text(error!)),
        Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(children:[
          const Text('Demo wallet',style:TextStyle(fontSize:20,fontWeight:FontWeight.bold)),
          Text('Rivo Coins: '+(wallet?['coins']?.toString()??'—')),
          Text('Creator points: '+(wallet?['creatorPoints']?.toString()??'—')),
          Text('Agency points: '+(wallet?['agencyPoints']?.toString()??'—')),
          const SizedBox(height:8),
          OutlinedButton(onPressed:busy?null:credit,child:const Text('Claim one-time demo coins')),
        ]))),
        const SizedBox(height:12),
        const Text('Agency management',style:TextStyle(fontSize:20,fontWeight:FontWeight.bold)),
        FilledButton.icon(onPressed:createAgency,
          icon:const Icon(Icons.group_add),label:const Text('Create agency')),
        if(m!=null)...[
          Text('My membership status: '+(m['status'] as String)),
          if(m['status']=='INVITED')OutlinedButton(onPressed:accept,
            child:const Text('Accept agency invitation')),
        ],
        ...owned.map((a){
          final agency=a as Map<String,dynamic>;
          final members=agency['members'] as List<dynamic>;
          return ListTile(title:Text(agency['name'] as String),
            subtitle:Text('Invited/active creators: '+members.length.toString()));
        }),
        const SizedBox(height:12),
        const Text('Virtual activity',style:TextStyle(fontSize:20,fontWeight:FontWeight.bold)),
        ...ledger.map((value){
          final entry=value as Map<String,dynamic>;
          return ListTile(
            title:Text(entry['kind'] as String),
            subtitle:Text(entry['walletType'] as String),
            trailing:Text(entry['delta'].toString()),
          );
        }),
      ]),
    );
  }
}

class RivoLiveGifts extends StatefulWidget {
  const RivoLiveGifts({super.key,required this.api,required this.roomId,required this.hostId});
  final Api api;
  final String roomId;
  final String hostId;
  @override State<RivoLiveGifts> createState()=>_RivoLiveGiftsState();
}
class _RivoLiveGiftsState extends State<RivoLiveGifts> {
  String? error;
  Map<String,dynamic>? battle;
  bool busy=false;
  @override void initState(){super.initState();refresh();}
  Future<void> refresh() async {
    try {
      final data=await widget.api.call('GET','/rivo/rooms/'+widget.roomId+'/battle') as Map<String,dynamic>;
      if(mounted)setState((){battle=data['battle'] as Map<String,dynamic>?;error=null;});
    }catch(e){if(mounted)setState(()=>error=e.toString());}
  }
  Future<void> send(String giftCode) async {
    if(busy)return;
    setState(()=>busy=true);
    try {
      // The user can only gift the room host from this first-phase UI.
      // Guest gifting can be added with an explicit recipient picker.
      final id=DateTime.now().microsecondsSinceEpoch.toRadixString(16);
      final key='00000000-0000-4000-8000-'+id.padLeft(12,'0').substring(0,12);
      await widget.api.call('POST','/rivo/gifts',{
        'roomId':widget.roomId,'recipientId':widget.hostId,
        'giftCode':giftCode,'idempotencyKey':key
      });
      await refresh();
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content:Text('Demo gift sent')));
    }catch(e){if(mounted)setState(()=>error=e.toString());}
    finally{if(mounted)setState(()=>busy=false);}
  }
  @override Widget build(BuildContext context)=>ExpansionTile(
    title:const Text('Battles & demo gifts'),
    children:[
      const Text('Virtual demonstration only — no real-money value'),
      if(error!=null)Text(error!),
      if(battle!=null)ListTile(
        title:Text('Battle: '+(battle!['status'] as String)),
        subtitle:Text('Host '+battle!['hostScore'].toString()+
          ' • Guest '+battle!['guestScore'].toString())),
      Wrap(spacing:8,children:[
        OutlinedButton(onPressed:busy?null:()=>send('rose'),
          child:const Text('🌹 Rose • 10')),
        OutlinedButton(onPressed:busy?null:()=>send('star'),
          child:const Text('⭐ Star • 50')),
        OutlinedButton(onPressed:busy?null:()=>send('comet'),
          child:const Text('☄️ Comet • 100')),
        IconButton(onPressed:refresh,icon:const Icon(Icons.refresh)),
      ])
    ]
  );
}
