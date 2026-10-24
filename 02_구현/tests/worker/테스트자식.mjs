// W1 전용 통제 자식. 네트워크/파일/외부 프로그램 실행 없음, 후손 생성 없음.
process.send?.({ready:true,pid:process.pid});
setInterval(()=>{},1000);
