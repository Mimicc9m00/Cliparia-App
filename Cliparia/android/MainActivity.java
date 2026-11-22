package br.cliparia.mobile.controle;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.os.Environment;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.webkit.*;
import android.widget.*;
import java.io.ByteArrayInputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
 private final int background=0xff121613,surface=0xff1a211c,border=0xff354239,ink=0xffedf2ed,muted=0xffaab7ad,accent=0xffb8ed91;
 private WebView browser;

 @Override public void onCreate(Bundle state){super.onCreate(state);connectScreen();}
 @Override protected void onDestroy(){closeBrowser();super.onDestroy();}

 private int dp(int value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private LinearLayout column(){LinearLayout panel=new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);return panel;}
 private void setScreen(View root){
  root.setBackgroundColor(background);
  root.setOnApplyWindowInsetsListener((view,insets)->{
   view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
   return insets.consumeSystemWindowInsets();
  });
  setContentView(root);root.requestApplyInsets();
 }
 private GradientDrawable rounded(int fill){
  GradientDrawable shape=new GradientDrawable();shape.setColor(fill);shape.setCornerRadius(dp(12));shape.setStroke(dp(1),border);return shape;
 }
 private TextView text(LinearLayout group,String label,int size,int color){
  TextView field=new TextView(this);field.setText(label);field.setTextSize(size);field.setTextColor(color);group.addView(field);return field;
 }
 private Button button(String label,boolean primary){
  Button control=new Button(this);control.setText(label);control.setAllCaps(false);control.setMinHeight(dp(46));
  control.setTextColor(primary?background:ink);control.setBackgroundTintList(ColorStateList.valueOf(primary?accent:surface));return control;
 }
 private EditText field(LinearLayout panel,String label,int type){
  text(panel,label,13,muted).setPadding(0,dp(13),0,dp(6));
  EditText edit=new EditText(this);edit.setSingleLine();edit.setInputType(type);edit.setTextColor(ink);edit.setTextSize(16);
  edit.setPadding(dp(12),dp(12),dp(12),dp(12));edit.setBackground(rounded(background));panel.addView(edit);return edit;
 }
 private void showError(String detail){new AlertDialog.Builder(this).setMessage(detail).setPositiveButton("OK",null).show();}
 private void closeBrowser(){
  if(browser==null)return;
  browser.stopLoading();
  if(browser.getParent() instanceof LinearLayout)((LinearLayout)browser.getParent()).removeView(browser);
  browser.destroy();browser=null;
 }
 private void connectScreen(){
  closeBrowser();
  ScrollView scroll=new ScrollView(this);
  LinearLayout root=column();root.setPadding(dp(22),dp(30),dp(22),dp(32));scroll.addView(root);
  text(root,"Cliparia",34,accent).setTypeface(Typeface.DEFAULT,Typeface.BOLD);
  text(root,"Cortes e fila de postagem",17,ink).setPadding(0,dp(4),0,dp(20));
  LinearLayout panel=column();panel.setPadding(dp(16),dp(16),dp(16),dp(16));panel.setBackground(rounded(surface));root.addView(panel);
  text(panel,"Conectar ao Cliparia",21,ink).setTypeface(Typeface.DEFAULT,Typeface.BOLD);
  text(panel,"Cole o link gerado na aba Celular do PC ou informe o endereço HTTPS do seu servidor.",14,muted).setPadding(0,dp(8),0,dp(6));
  EditText address=field(panel,"Link de acesso",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);
  address.setText(getPreferences(MODE_PRIVATE).getString("server",""));
  LinearLayout credentials=column();panel.addView(credentials);
  EditText user=field(credentials,"Usuário do servidor",InputType.TYPE_CLASS_TEXT);
  EditText password=field(credentials,"Senha do servidor",InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);
  Runnable update=()->credentials.setVisibility(address.getText().toString().startsWith("https://")&&!address.getText().toString().contains("#revisao=")?View.VISIBLE:View.GONE);
  address.addTextChangedListener(new android.text.TextWatcher(){
   public void beforeTextChanged(CharSequence s,int start,int count,int after){}
   public void onTextChanged(CharSequence s,int start,int before,int count){update.run();}
   public void afterTextChanged(android.text.Editable text){}
  });
  update.run();
  Button connect=button("Conectar",true);
  LinearLayout.LayoutParams layout=new LinearLayout.LayoutParams(-1,-2);layout.topMargin=dp(16);panel.addView(connect,layout);
  connect.setOnClickListener(v->{
   try{
    URI uri=new URI(address.getText().toString().trim());
    String host=uri.getHost(),scheme=uri.getScheme(),fragment=uri.getRawFragment();
    boolean https="https".equals(scheme),paired=fragment!=null&&fragment.matches("revisao=[A-Za-z0-9_-]{32}");
    if(host==null||uri.getRawUserInfo()!=null||uri.getRawQuery()!=null||!(uri.getPath().isEmpty()||uri.getPath().equals("/"))||(fragment!=null&&!paired))throw new Exception("Confira o endereço ou cole o link completo de revisão.");
    if(!https&&!(paired&&"http".equals(scheme)&&host.matches("(?:10\\.|192\\.168\\.|172\\.(?:1[6-9]|2[0-9]|3[01])\\.)[0-9.]+")))throw new Exception("Use o link da rede local gerado no PC ou um endereço HTTPS.");
    String username=paired?"":user.getText().toString().trim(),secret=paired?"":password.getText().toString();
    if(username.contains(":")||username.isEmpty()!=secret.isEmpty())throw new Exception("Informe usuário e senha do servidor.");
    String base=scheme+"://"+uri.getRawAuthority();
    if(https&&!paired)getPreferences(MODE_PRIVATE).edit().putString("server",base).apply();
    open(base,uri,fragment,username,secret);
   }catch(Exception error){showError(error.getMessage()==null?"Endereço inválido.":error.getMessage());}
  });
  setScreen(scroll);
 }

 private static int port(String scheme,int value){return value>=0?value:"https".equals(scheme)?443:80;}
 private static boolean sameOrigin(URI website,Uri request){
  return website.getScheme().equals(request.getScheme())&&website.getHost().equalsIgnoreCase(request.getHost())&&port(website.getScheme(),website.getPort())==port(request.getScheme(),request.getPort());
 }
 private void open(String base,URI origin,String fragment,String username,String secret){
  LinearLayout root=column();
  LinearLayout toolbar=new LinearLayout(this);toolbar.setGravity(Gravity.END|Gravity.CENTER_VERTICAL);toolbar.setPadding(dp(10),0,dp(10),0);
  Button back=button("Trocar conexão",false);back.setOnClickListener(v->connectScreen());toolbar.addView(back);root.addView(toolbar,-1,-2);
  WebView web=new WebView(this);browser=web;web.setBackgroundColor(background);root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
  settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager cookies=CookieManager.getInstance();cookies.setAcceptCookie(true);cookies.setAcceptThirdPartyCookies(web,false);
  web.setWebChromeClient(new WebChromeClient());
  web.setWebViewClient(new WebViewClient(){
   private boolean attemptedAuth;
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
    Uri page=request.getUrl();
    if(sameOrigin(origin,page))return false;
    if(request.isForMainFrame()&&request.hasGesture()&&"https".equals(page.getScheme())){
     try{startActivity(new Intent(Intent.ACTION_VIEW,page));}catch(Exception ignored){}
    }
    return true;
   }
   @Override public void onReceivedHttpAuthRequest(WebView view,HttpAuthHandler auth,String host,String realm){
    if(fragment==null&&!attemptedAuth&&!username.isEmpty()&&(host.equalsIgnoreCase(origin.getHost())||host.equalsIgnoreCase(origin.getRawAuthority()))){
     attemptedAuth=true;auth.proceed(username,secret);return;
    }
    auth.cancel();showError("Confira o usuário e a senha do servidor e use Trocar conexão para tentar novamente.");
   }
   @Override public void onReceivedSslError(WebView view,SslErrorHandler handler,SslError error){handler.cancel();showError("O certificado HTTPS do servidor não pôde ser validado.");}
   @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){
    Uri uri=request.getUrl();String scheme=uri.getScheme();
    if(("http".equals(scheme)||"https".equals(scheme))&&!sameOrigin(origin,uri))return new WebResourceResponse("text/plain","UTF-8",new ByteArrayInputStream(new byte[0]));
    return null;
   }
  });
  web.setDownloadListener((url,agent,disposition,mime,size)->{
   Uri uri=Uri.parse(url);
   if(!sameOrigin(origin,uri)||uri.getPath()==null||!uri.getPath().startsWith("/video/"))return;
   try{
    DownloadManager.Request download=new DownloadManager.Request(uri);
    String cookie=cookies.getCookie(url);
    if(cookie!=null)download.addRequestHeader("Cookie",cookie);
    if(!username.isEmpty())download.addRequestHeader("Authorization","Basic "+Base64.encodeToString((username+":"+secret).getBytes(StandardCharsets.UTF_8),Base64.NO_WRAP));
    download.setMimeType("video/mp4");download.setTitle("Corte do Cliparia");
    download.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
    download.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS,"cliparia-"+System.currentTimeMillis()+".mp4");
    getSystemService(DownloadManager.class).enqueue(download);
    Toast.makeText(this,"O corte será salvo em Downloads.",Toast.LENGTH_SHORT).show();
   }catch(Exception error){showError("Não foi possível iniciar o download do corte.");}
  });
  setScreen(root);web.loadUrl(base+"/?mobile=1#"+(fragment==null?"postagem":fragment));
 }
}
