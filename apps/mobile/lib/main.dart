import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

const violet = Color(0xFF8B5CF6);
const magenta = Color(0xFFEC4899);
const midnight = Color(0xFF0B0715);
const apiBase = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:4000');

void main() { WidgetsFlutterBinding.ensureInitialized(); runApp(const Rivonix()); }

class Api {
  Api(this.storage);
  final FlutterSecureStorage storage;
  String? token;
  Future<void> restore() async => token = await storage.read(key: 'rivonix_token');
  Future<dynamic> call(String method, String path, [Map<String,dynamic>? body]) async {
    final r = http.Request(method, Uri.parse('$apiBase$path'));
    r.headers['Content-Type'] = 'application/json';
    if (token != null) r.headers['Authorization'] = 'Bearer $token';
    if (body != null) r.body = jsonEncode(body);
    final streamed = await r.send().timeout(const Duration(seconds: 15));
    final response = await http.Response.fromStream(streamed);
    final data = response.body.isNotEmpty ? jsonDecode(response.body) : null;
    if (response.statusCode >= 400) throw Exception(data is Map ? (data['error'] ?? 'Request failed') : 'Request failed (${response.statusCode})');
    return data;
  }
  Future<void> setToken(String value) async { token = value; await storage.write(key: 'rivonix_token', value: value); }
  Future<void> logout() async { token = null; await storage.delete(key: 'rivonix_token'); }
}

class Rivonix extends StatefulWidget { const Rivonix({super.key}); @override State<Rivonix> createState() => _RivonixState(); }
class _RivonixState extends State<Rivonix> {
  final api = Api(const FlutterSecureStorage());
  bool loading = true;
  @override void initState(){super.initState(); api.restore().then((_){if(mounted)setState(()=>loading=false);});}
  @override Widget build(BuildContext context) => MaterialApp(
    title:'Rivonix', debugShowCheckedModeBanner:false,
    theme: ThemeData(brightness: Brightness.dark, scaffoldBackgroundColor: midnight, colorScheme: ColorScheme.fromSeed(seedColor: violet, brightness: Brightness.dark), useMaterial3:true, appBarTheme: const AppBarTheme(backgroundColor: midnight)),
    home: loading ? const Scaffold(body:Center(child:CircularProgressIndicator())) : api.token == null
      ? AuthScreen(api: api, onSignedIn: ()=>setState((){}))
      : Shell(api:api,onLogout:()=>setState((){})),
  );
}

class AuthScreen extends StatefulWidget {const AuthScreen({super.key,required this.api,required this.onSignedIn}); final Api api; final VoidCallback onSignedIn; @override State<AuthScreen> createState()=>_AuthScreenState();}
class _AuthScreenState extends State<AuthScreen> {
  final email = TextEditingController(), password=TextEditingController(), username=TextEditingController(), name=TextEditingController();
  bool register = false, busy = false; String? error;
  @override void dispose(){email.dispose();password.dispose();username.dispose();name.dispose();super.dispose();}
  Future<void> submit() async {
    setState((){busy=true;error=null;});
    try {
      final data=await widget.api.call('POST', register?'/auth/register':'/auth/login',{
        'email':email.text.trim(),'password':password.text,
        if(register) ...{'username':username.text.trim(),'displayName':name.text.trim()},
      }) as Map<String,dynamic>;
      await widget.api.setToken(data['token'] as String);
      widget.onSignedIn();
    } catch(e) {if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));}
    finally {if(mounted)setState(()=>busy=false);}
  }
  @override Widget build(BuildContext context)=>Scaffold(body:SafeArea(child:Center(child:SingleChildScrollView(padding:const EdgeInsets.all(28),child:ConstrainedBox(constraints:const BoxConstraints(maxWidth:420),child:Column(crossAxisAlignment:CrossAxisAlignment.stretch,children:[
    const Icon(Icons.bolt,size:76,color:magenta),const Text('RIVONIX',textAlign:TextAlign.center,style:TextStyle(fontSize:38,fontWeight:FontWeight.bold,letterSpacing:5)),
    const SizedBox(height:8),const Text('Create. Connect. Go LIVE.',textAlign:TextAlign.center),const SizedBox(height:36),
    if(register)...[TextField(controller:name,decoration:const InputDecoration(labelText:'Display name')),TextField(controller:username,decoration:const InputDecoration(labelText:'Username'))],
    TextField(controller:email,keyboardType:TextInputType.emailAddress,decoration:const InputDecoration(labelText:'Email')),
    TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password (10+ characters)')),
    const SizedBox(height:20),if(error!=null) Text(error!,style:const TextStyle(color:Colors.redAccent)),
    FilledButton(onPressed:busy?null:submit,child:Text(register?'Create account':'Sign in')),
    TextButton(onPressed:busy?null:()=>setState(()=>register=!register),child:Text(register?'Already registered? Sign in':'New here? Create account'))
  ]))))));
}
class Shell extends StatefulWidget {const Shell({super.key,required this.api,required this.onLogout});final Api api;final VoidCallback onLogout;@override State<Shell> createState()=>_ShellState();}
class _ShellState extends State<Shell> {
 int index=0;
 final labels=const ['Home','Explore','LIVE','Alerts','Profile'];
 @override Widget build(BuildContext context)=>Scaffold(
   appBar:AppBar(title:Text(index==0?'RIVONIX':labels[index],style:const TextStyle(fontWeight:FontWeight.bold,letterSpacing:2))),
   body:IndexedStack(index:index,children:[Feed(api:widget.api),const PlaceholderScreen(icon:Icons.explore,title:'Explore',subtitle:'Creator discovery and search are coming next.'),const PlaceholderScreen(icon:Icons.live_tv,title:'LIVE',subtitle:'Agora streaming is not connected yet.'),const PlaceholderScreen(icon:Icons.notifications,title:'Notifications',subtitle:'Real-time notifications are not connected yet.'),Profile(api:widget.api,onLogout:widget.onLogout)]),
   bottomNavigationBar:NavigationBar(selectedIndex:index,onDestinationSelected:(i)=>setState(()=>index=i),destinations:const [
     NavigationDestination(icon:Icon(Icons.home_outlined),selectedIcon:Icon(Icons.home),label:'Home'),
     NavigationDestination(icon:Icon(Icons.search),label:'Explore'),
     NavigationDestination(icon:Icon(Icons.wifi_tethering,color:magenta),label:'LIVE'),
     NavigationDestination(icon:Icon(Icons.notifications_none),label:'Alerts'),
     NavigationDestination(icon:Icon(Icons.person_outline),label:'Profile'),
   ]),
 );
}
class Feed extends StatefulWidget {const Feed({super.key,required this.api});final Api api;@override State<Feed> createState()=>_FeedState();}
class _FeedState extends State<Feed> {
 List<dynamic> items=[];bool loading=true;String? error;
 @override void initState(){super.initState();load();}
 Future<void> load() async {try {final data=await widget.api.call('GET','/posts'); if(mounted)setState((){items=(data['items'] as List<dynamic>);error=null;});} catch(e){if(mounted)setState(()=>error=e.toString());}finally{if(mounted)setState(()=>loading=false);}}
 Future<void> compose() async {final text=TextEditingController();final created=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(title:const Text('New post'),content:TextField(controller:text,maxLines:5,maxLength:2000,decoration:const InputDecoration(hintText:'What is happening?')),actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('Cancel')),FilledButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('Post'))]));if(created==true&&text.text.trim().isNotEmpty){try{await widget.api.call('POST','/posts',{'text':text.text.trim()});await load();}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$e')));}}text.dispose();}
 Future<void> like(String id) async {try{await widget.api.call('POST','/posts/$id/likes');await load();}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('$e')));}}
 @override Widget build(BuildContext context)=>Column(children:[Padding(padding:const EdgeInsets.all(12),child:Row(children:[const Expanded(child:Text('Your feed',style:TextStyle(fontSize:22,fontWeight:FontWeight.bold))),IconButton(onPressed:load,icon:const Icon(Icons.refresh)),FilledButton.icon(onPressed:compose,icon:const Icon(Icons.add),label:const Text('Post'))])),Expanded(child:loading?const Center(child:CircularProgressIndicator()):error!=null?Center(child:Text(error!)):RefreshIndicator(onRefresh:load,child:items.isEmpty?ListView(children:const [SizedBox(height:120),Center(child:Text('No posts yet. Create the first one!'))]):ListView.builder(itemCount:items.length,itemBuilder:(ctx,i){final item=items[i] as Map<String,dynamic>;final author=item['author'] as Map<String,dynamic>;final counts=item['_count'] as Map<String,dynamic>;return Card(margin:const EdgeInsets.symmetric(horizontal:12,vertical:6),child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text("${author['displayName']}  @${author['username']}",style:const TextStyle(fontWeight:FontWeight.bold)),const SizedBox(height:10),Text(item['text'] as String),const SizedBox(height:12),Row(children:[IconButton(onPressed:()=>like(item['id'] as String),icon:const Icon(Icons.favorite_border,color:magenta)),Text("${counts['likes']}"),const SizedBox(width:14),const Icon(Icons.chat_bubble_outline,size:18),Text(" ${counts['comments']}")])])));})))]);
}
class PlaceholderScreen extends StatelessWidget {const PlaceholderScreen({super.key,required this.icon,required this.title,required this.subtitle});final IconData icon;final String title,subtitle;@override Widget build(BuildContext context)=>Center(child:Padding(padding:const EdgeInsets.all(32),child:Column(mainAxisSize:MainAxisSize.min,children:[Icon(icon,size:65,color:violet),const SizedBox(height:18),Text(title,style:const TextStyle(fontSize:26,fontWeight:FontWeight.bold)),const SizedBox(height:8),Text(subtitle,textAlign:TextAlign.center)])));}
class Profile extends StatefulWidget {const Profile({super.key,required this.api,required this.onLogout});final Api api;final VoidCallback onLogout;@override State<Profile> createState()=>_ProfileState();}
class _ProfileState extends State<Profile> {Map<String,dynamic>? user;String? error;@override void initState(){super.initState();refresh();}Future<void> refresh() async {try{final data=await widget.api.call('GET','/me');if(mounted)setState((){user=data as Map<String,dynamic>;error=null;});}catch(e){if(mounted)setState(()=>error='$e');}}@override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(24),children:[const CircleAvatar(radius:42,backgroundColor:violet,child:Icon(Icons.person,size:44)),const SizedBox(height:22),if(error!=null)Text(error!),if(user!=null)...[Text(user!['displayName'] as String,textAlign:TextAlign.center,style:const TextStyle(fontSize:26,fontWeight:FontWeight.bold)),Text('@${user!['username']}',textAlign:TextAlign.center),const SizedBox(height:10),Text(user!['bio'] as String,textAlign:TextAlign.center)],const SizedBox(height:30),OutlinedButton(onPressed:refresh,child:const Text('Refresh profile')),TextButton(onPressed:() async {await widget.api.logout();widget.onLogout();},child:const Text('Sign out'))]);}}
