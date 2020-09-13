import React, { useState, useRef, useEffect } from 'react'
import 'antd/dist/antd.css';
import "./App.css";
import { UndoOutlined, ClearOutlined, PlaySquareOutlined, HighlightOutlined, BgColorsOutlined, BorderOutlined } from '@ant-design/icons';
import { Row, Button, Input, InputNumber, Form, Typography, notification, message, Spin, Col, Slider, Space } from 'antd';
import { useLocalStorage } from "./hooks"
import { addToIPFS, getFromIPFS, transactionHandler } from "./helpers"
import CanvasDraw from "react-canvas-draw";
import drawImage from "react-canvas-draw/lib/drawImage";
import { SketchPicker, CirclePicker, TwitterPicker } from 'react-color';
import LZ from "lz-string";

const Hash = require('ipfs-only-hash')
const pickers = [CirclePicker, TwitterPicker, SketchPicker]

export default function InkCanvas(props) {

  //const writeContracts = useContractLoader(props.injectedProvider);
  //const metaWriteContracts = useContractLoader(props.metaProvider);
  //const tx = Transactor(props.kovanProvider,props.gasPrice)

  const [picker, setPicker] = useLocalStorage("picker", 0)
  const [color, setColor] = useLocalStorage("color", "#666666")
  const [brushRadius, setBrushRadius] = useState(8)

  const drawingCanvas = useRef(null);
  const size = [0.8 * props.calculatedVmin, 0.8 * props.calculatedVmin]

  const [sending, setSending] = useState()
  const [immediateDrawing, setImmediateDrawing] = useState(false)

  const updateBrushRadius = value => {
    setBrushRadius(value)
  }

  const saveDrawing = (newDrawing) => {
    let savedData = LZ.compress(newDrawing.getSaveData())
    props.saveDrawingToLocalStorage(savedData)
  }

  useEffect(() => {
    const loadPage = async () => {
      console.log('loadpage')
      if (props.ipfsHash) {
        console.log('ipfsHash Set')
      }
      else if (props.drawing && props.drawing !== "") {
        try {
          let decompressed = LZ.decompress(props.drawing)
          drawingCanvas.current.loadSaveData(decompressed, false)
        } catch (e) {
          console.log(e)
        }
      }
    }
    window.drawingCanvas = drawingCanvas
    loadPage()
  }, [])

  useEffect(() => {
    const showDrawing = async () => {
      if (props.ipfsHash && props.viewDrawing && props.viewDrawing !== "") {
        console.log("got viewDrawing")
      } else if (props.ipfsHash) {
        console.log("no viewDrawing")
        let drawingContent = await getFromIPFS(props.ipfsHash, props.ipfsConfigInfura)
        try {
          const arrays = new Uint8Array(drawingContent._bufs.reduce((acc, curr) => [...acc, ...curr], []));
          let decompressed = LZ.decompressFromUint8Array(arrays)
          
          const contentJson = JSON.parse(decompressed);
          console.log(contentJson)
          
          const lines = contentJson['lines'];
          
          const totalPointCount = lines.reduce((acc, curr) => acc + curr.points.length, 0)
          console.log('Total drawing points', totalPointCount)
          
          setImmediateDrawing(totalPointCount >= 10000)

          props.setViewDrawing(decompressed)
          props.setBgImageIPFS(contentJson['bgImageIPFS'])

          triggerOnChange(lines)
        } catch (e) { console.log("Drawing Error:", e) }
      }
    }
    showDrawing()
  }, [props.ipfsHash])

  const PickerDisplay = pickers[picker % pickers.length]

  const mintInk = async (inkUrl, jsonUrl, limit) => {

    let contractName = "NiftyInk"
    let regularFunction = "createInk"
    let regularFunctionArgs = [inkUrl, jsonUrl, props.ink.attributes[0]['value']]
    let signatureFunction = "createInkFromSignature"
    let signatureFunctionArgs = [inkUrl, jsonUrl, props.ink.attributes[0]['value'], props.address]
    let getSignatureTypes = ['bytes', 'bytes', 'address', 'address', 'string', 'string', 'uint256']
    let getSignatureArgs = ['0x19', '0x0', props.readKovanContracts["NiftyInk"].address, props.address, inkUrl, jsonUrl, limit]

    let createInkConfig = {
      ...props.transactionConfig,
      contractName,
      regularFunction,
      regularFunctionArgs,
      signatureFunction,
      signatureFunctionArgs,
      getSignatureTypes,
      getSignatureArgs,
    }

    console.log(createInkConfig)

    let result = await transactionHandler(createInkConfig)

    return result
  }

  const createInk = async values => {
    console.log('Success:', values);

    setSending(true)

    let imageData = drawingCanvas.current.canvas.drawing.toDataURL("image/png");

    let decompressed = LZ.decompress(props.drawing)
    let compressedArray = LZ.compressToUint8Array(decompressed)

    let drawingBuffer = Buffer.from(compressedArray)
    let imageBuffer = Buffer.from(imageData.split(",")[1], 'base64')

    let currentInk = props.ink

    currentInk['attributes'] = [{
      "trait_type": "Limit",
      "value": values.limit.toString()
    }]
    currentInk['name'] = values.title
    let newEns
    try {
      newEns = await props.mainnetProvider.lookupAddress(props.address)
    } catch (e) { console.log(e) }
    const timeInMs = new Date()
    const addressForDescription = !newEns ? props.address : newEns
    currentInk['description'] = 'A Nifty Ink by ' + addressForDescription + ' on ' + timeInMs.toUTCString()

    props.setIpfsHash()

    const drawingHash = await Hash.of(drawingBuffer)
    console.log("drawingHash", drawingHash)
    const imageHash = await Hash.of(imageBuffer)
    console.log("imageHash", imageHash)

    currentInk['drawing'] = drawingHash
    currentInk['image'] = 'https://ipfs.io/ipfs/' + imageHash
    currentInk['external_url'] = 'https://nifty.ink/' + drawingHash
    currentInk['bgImageIPFS'] = props.bgImageIPFS
    props.setInk(currentInk)
    console.log("Ink:", props.ink)

    var inkStr = JSON.stringify(props.ink);
    const inkBuffer = Buffer.from(inkStr);

    const jsonHash = await Hash.of(inkBuffer)
    console.log("jsonHash", jsonHash)

    try {
      var mintResult = await mintInk(drawingHash, jsonHash, values.limit.toString());
    } catch (e) {
      console.log(e)
      setSending(false)
      if (e.message.indexOf("Relay not ready") >= 0) {
        notification.open({
          message: '📛 Sorry! Transaction limit reached. 😅',
          description:
            "⏳ Please try again in a few seconds. 📡",
        });
      } else if (e.message.indexOf("Ping errors") >= 0) {
        notification.open({
          message: '📛 Sorry! 📡 Relay Error. 😅',
          description:
            "⏳ Please try again in a few seconds. 📡",
        });
      } else {
        notification.open({
          message: 'Inking error',
          description:
            e.message,
        })
      }
    }

    if (mintResult) {

      props.setViewDrawing(LZ.decompress(props.drawing))
      setImmediateDrawing(true)
      props.setMode("mint")
      props.setIpfsHash(drawingHash)
      props.saveDrawingToLocalStorage("")
      window.history.pushState({ id: drawingHash }, props.ink['name'], '/' + drawingHash)


      /*
      let serverUrl = "https://ipfs.nifty.ink:3001/save"//'http://localhost:3001/save'
 
      console.log("SAVING TO SERVER BUFFER:", drawingBuffer)
      axios.post(serverUrl, {buffer: drawingBuffer})
      .then(function (response) {
        console.log(" drawingBuffer SERVER RESPONSE LOCAL:",response);
 
      })
      .catch(function (error) {
        console.log(error);
      });
 
      console.log("SAVING TO SERVER BUFFER:", imageBuffer)
      axios.post(serverUrl,  {buffer: imageBuffer})
      .then(function (response) {
        console.log(" imageBuffer SERVER RESPONSE LOCAL:",response);
 
      })
      .catch(function (error) {
        console.log(error);
      });
 
      console.log("SAVING TO SERVER BUFFER:", inkBuffer)
      axios.post(serverUrl,  {buffer: inkBuffer})
      .then(function (response) {
        console.log("inkBuffer SERVER RESPONSE LOCAL:",response);
 
      })
      .catch(function (error) {
        console.log(error);
        setSending(false)
      });*/

      const drawingResult = addToIPFS(drawingBuffer, props.ipfsConfig)
      const imageResult = addToIPFS(imageBuffer, props.ipfsConfig)
      const inkResult = addToIPFS(inkBuffer, props.ipfsConfig)

      const drawingResultInfura = addToIPFS(drawingBuffer, props.ipfsConfigInfura)
      const imageResultInfura = addToIPFS(imageBuffer, props.ipfsConfigInfura)
      const inkResultInfura = addToIPFS(inkBuffer, props.ipfsConfigInfura)


      setSending(false)

      Promise.all([drawingResult, imageResult, inkResult]).then((values) => {
        console.log("FINISHED UPLOADING TO PINNER", values);
        message.destroy()
        //setMode("mint")
        /*notification.open({
          message: (<><span style={{marginRight:8}}>💾</span>  Ink saved!</>),
          description:
          ' 🍾  🎊   🎉   🥳  🎉   🎊  🍾 ',
        });*/
      });


      Promise.all([drawingResultInfura, imageResultInfura, inkResultInfura]).then((values) => {
        console.log("INFURA FINISHED UPLOADING!", values);
      });
    }
  };

  const uploadImage = (event) => {
    console.log('upload image to ipfs is triggered')

    event.stopPropagation()
    event.preventDefault()

    const uploadFileDom = document.getElementById('upload_file');

    if (uploadFileDom && uploadFileDom.files && uploadFileDom.files[0]) {
      const reader = new window.FileReader()

      reader.onloadend = () => {
        const buffer = Buffer.from(reader.result)

        return addToIPFS(buffer, props.ipfsConfig).then(result => {
          console.log('bg image ipfs link is saved')

          props.setBgImageIPFS("https://ipfs.io/ipfs/" + result.path)

          triggerOnChange(drawingCanvas.current.lines)
        }).catch(e => {
          console.log('IPFS bg image upload error' + e.message)
          console.log(e)

          throw e
        })
      }

      reader.readAsArrayBuffer(uploadFileDom.files[0])
    }
  }

  const clearBgImageIPFS = () => {
    console.log('clear bg image triggered')

    props.setBgImageIPFS()
    
    triggerOnChange(drawingCanvas.current.lines)
  }

  const drawBGImage = (ctx = drawingCanvas.current.ctx.drawing) => {
    if (!props.bgImageIPFS) {
      console.log('bgImageIPFS was empty: clearing')

      drawingCanvas.current.clear()
    } else {
      console.log('bgImageIPFS is not empty: drawing')
      // Load the image
      const tempImage = new Image();

      // Prevent SecurityError "Tainted canvases may not be exported." #70
      tempImage.crossOrigin = "anonymous";

      // Draw the image once loaded
      tempImage.onload = () =>
        drawImage({ ctx, img: tempImage });
        tempImage.src = props.bgImageIPFS;
    }
  }

  const onFinishFailed = errorInfo => {
    console.log('Failed:', errorInfo);
  };

  const triggerOnChange = (lines) => {
    console.log('trigger on change is triggered :)')

    drawBGImage();

    let saved = JSON.stringify({
      lines: lines,
      width: drawingCanvas.current.props.canvasWidth,
      height: drawingCanvas.current.props.canvasHeight
    });

    drawingCanvas.current.loadSaveData(saved, true);
    drawingCanvas.current.lines = lines;
  };

  // TODO: remove later. for my easy exploration
  window.nifty = {
    triggerOnChange,
    drawBGImage
  }

  const undo = () => {
    if (!drawingCanvas.current.lines.length) return;

    if (drawingCanvas.current.lines[drawingCanvas.current.lines.length - 1].ref) {
      drawingCanvas.current.lines[0].brushColor = drawingCanvas.current.lines[drawingCanvas.current.lines.length - 1].brushColor;
      let lines = drawingCanvas.current.lines.slice(0, -1);
      triggerOnChange(lines);
    } else {
      let lines = drawingCanvas.current.lines.slice(0, -1);
      triggerOnChange(lines);
    }
  };

  const fillBackground = (color) => {
    let width = drawingCanvas.current.props.canvasWidth;
    let height = drawingCanvas.current.props.canvasHeight;

    let bg = {
      brushColor: color.hex,
      brushRadius: (width + height) / 2,
      points: [
        { x: 0, y: 0 },
        { x: width, y: height }
      ],
      background: true
    };

    let previousBGColor = drawingCanvas.current.lines.filter((l) => l.ref).length
      ? drawingCanvas.current.lines[0].brushColor
      : "#FFF";

    let bgRef = {
      brushColor: previousBGColor,
      brushRadius: 1,
      points: [
        { x: -1, y: -1 },
        { x: -1, y: -1 }
      ],
      ref: true
    };

    drawingCanvas.current.lines.filter((l) => l.background).length
      ? drawingCanvas.current.lines.splice(0, 1, bg)
      : drawingCanvas.current.lines.unshift(bg);
    drawingCanvas.current.lines.push(bgRef);

    let lines = drawingCanvas.current.lines;

    triggerOnChange(lines);
  };

  const drawFrame = (color, radius) => {
    let width = drawingCanvas.current.props.canvasWidth;
    let height = drawingCanvas.current.props.canvasHeight;

    drawingCanvas.current.lines.push({
      brushColor: color.hex,
      brushRadius: radius,
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: width, y: height },
        { x: 0, y: height },
        { x: 0, y: height },
        { x: 0, y: 0 }
      ]
    });

    let lines = drawingCanvas.current.lines;

    triggerOnChange(lines);
  };

  let top, bottom, uploadedImageRow
  if (props.mode === "edit") {

    top = (
      <div style={{ width: "90vmin", margin: "0 auto", marginBottom: 16 }}>
        <Form
          layout={'inline'}
          name="createInk"
          //initialValues={{ limit: 0 }}
          onFinish={createInk}
          onFinishFailed={onFinishFailed}
          labelAlign={'middle'}
          style={{ justifyContent: 'center' }}
        >

          <Form.Item
            name="title"
            rules={[{ required: true, message: 'What is this work of art called?' }]}
          >
            <Input placeholder={"name"} style={{ fontSize: 16 }} />
          </Form.Item>

          <Form.Item
            name="limit"
            rules={[{ required: true, message: 'How many inks can be minted?' }]}
          >
            <InputNumber placeholder={"limit"}
              style={{ fontSize: 16 }}
              min={0}
              precision={0}
            />
          </Form.Item>

          <Form.Item >
            <Button loading={sending} type="primary" htmlType="submit">
              Ink!
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 16 }}>
          <Button onClick={() => undo()}><UndoOutlined /> UNDO</Button>
          <Button onClick={() => {
            drawingCanvas.current.clear()
            props.saveDrawingToLocalStorage()
          }}><ClearOutlined /> CLEAR</Button>
          <Button onClick={() => {
            drawingCanvas.current.loadSaveData(LZ.decompress(props.drawing), false)
          }}><PlaySquareOutlined /> PLAY</Button>
        </div>
      </div>

    )

    uploadedImageRow = props.bgImageIPFS ? (
      <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "4vh", justifyContent: 'center' }}>
        <Col span={5}>
          Uploaded Image
        </Col>
        <Col span={9}>
          <span>{props.bgImageIPFS}</span>
        </Col>
        <Col span={2}>
          <Button
            onClick={clearBgImageIPFS}
          >Clear Uploaded Image</Button>
        </Col>
      </Row>
    ) : (<></>)

    bottom = (
      <div style={{ marginTop: 16 }}>
        <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "4vh", display: 'inline-flex', justifyContent: 'center', alignItems: 'center' }}>
          <Space>
            <PickerDisplay
              color={color}
              onChangeComplete={setColor}
            />
            <Button onClick={() => {
              setPicker(picker + 1)
            }}><HighlightOutlined /></Button>
          </Space>
        </Row>
        <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "4vh", justifyContent: 'center' }}>
          <Col span={12}>
            <Slider
              min={1}
              max={100}
              onChange={updateBrushRadius}
              value={typeof brushRadius === 'number' ? brushRadius : 0}
            />
          </Col>
          <Col span={4}>
            <InputNumber
              min={1}
              max={100}
              style={{ margin: '0 16px' }}
              value={brushRadius}
              onChange={updateBrushRadius}
            />
          </Col>
        </Row>
        <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "4vh", justifyContent: 'center' }}>
          <Col span={4}>
            <Button
              onClick={() => fillBackground(color)}
            ><BgColorsOutlined />Background</Button>
          </Col>
          <Col span={4}>
            <Button
              onClick={() => drawFrame(color, brushRadius)}
            ><BorderOutlined />Frame</Button>
          </Col>
          <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "4vh", justifyContent: 'center' }}>
            <Col span={15}>
              <Input type={"file"} id="upload_file" placeholder={"Upload Image"} accept={"image/*"} style={{ fontSize: 16 }} />
            </Col>
            <Col span={1}>
              <Button
                onClick={uploadImage}
              >Upload</Button>
            </Col>
          </Row>
          {uploadedImageRow}
        </Row>
      </div>
    )
  } else if (props.mode === "mint") {

    top = (
      <div>
        <Row style={{ width: "90vmin", margin: "0 auto", marginTop: "1vh", justifyContent: 'center' }}>

          <Typography.Text style={{ color: "#222222" }} copyable={{ text: props.ink.external_url }} style={{ verticalAlign: "middle", paddingLeft: 5, fontSize: 28 }}>
            <a href={'/' + props.ipfsHash} style={{ color: "#222222" }}>{props.ink.name ? props.ink.name : <Spin />}</a>
          </Typography.Text>

          <Button style={{ marginTop: 4, marginLeft: 4 }} onClick={() => {
            setImmediateDrawing(false)
            drawingCanvas.current.loadSaveData(props.viewDrawing, false)
          }}><PlaySquareOutlined /> PLAY</Button>

        </Row>
      </div>

    )


    bottom = (<></>)
  }

  return (
    <div style={{ textAlign: "center" }}>
      {top}
      <div style={{ backgroundColor: "#666666", width: size[0], margin: "0 auto", border: "1px solid #999999", boxShadow: "2px 2px 8px #AAAAAA" }}>
        <CanvasDraw
          key={props.mode + "" + props.canvasKey}
          ref={drawingCanvas}
          canvasWidth={size[0]}
          canvasHeight={size[1]}
          brushColor={color.hex}
          lazyRadius={4}
          brushRadius={brushRadius}
          disabled={props.mode !== "edit"}
          hideGrid={props.mode !== "edit"}
          hideInterface={props.mode !== "edit"}
          onChange={props.mode === "edit" ? saveDrawing : null}
          saveData={props.mode === "edit" ? null : props.viewDrawing}
          immediateLoading={immediateDrawing}
          imgSrc={props.bgImageIPFS}
          loadTimeOffset={3}
        />
      </div>
      {bottom}
    </div>
  );
}
