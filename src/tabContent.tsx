import "./tabContent.scss"

import * as React from "react"
import * as ReactDOM from "react-dom"
import * as SDK from "azure-devops-extension-sdk"

import { getClient } from "azure-devops-extension-api"
import { ReleaseEnvironment, ReleaseRestClient, ReleaseTaskAttachment } from "azure-devops-extension-api/Release"
import { Build, BuildRestClient, Attachment } from "azure-devops-extension-api/Build"
import { CommonServiceIds, IProjectPageService } from "azure-devops-extension-api"

import { ObservableValue, ObservableObject } from "azure-devops-ui/Core/Observable"
import { Observer } from "azure-devops-ui/Observer"
import { Tab, TabBar, TabSize } from "azure-devops-ui/Tabs"
import { Card } from "azure-devops-ui/Card"
import { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";

const ATTACHMENT_TYPE = "postman.summary";
const REPORT_ATTACHMENT_TYPE = "postman.report";
const OUR_TASK_IDS = [
  // PROD
  "575a0243-fbcf-4695-98cf-118d49c1e2d8",
  // Finastra Dev
  "0e9f302d-865d-52f6-aba0-a0e258493f6d"
]

SDK.init()
SDK.ready().then(() => {
  try {
    const config = SDK.getConfiguration()
    if (typeof config.onBuildChanged === "function") {
      config.onBuildChanged((build: Build) => {
        let buildAttachmentClient = new BuildAttachmentClient(build)
        buildAttachmentClient.init().then(() => {
          displayReports(buildAttachmentClient)
        }).catch(error => {setError(error)})
      })
    } else if (typeof config.releaseEnvironment === "object") {
      let releaseAttachmentClient = new ReleaseAttachmentClient(config.releaseEnvironment)
      releaseAttachmentClient.init().then(() => {
        displayReports(releaseAttachmentClient)
      }).catch(error => {setError(error)})
    }
  } catch(error) {
    setError(error)
  }
})

function setText (message: string) {
  console.log(message)
  const messageContainer = document.querySelector("#postman-ext-message p")
  if (messageContainer) {
    messageContainer.innerHTML = message
  }
  const spinner = document.querySelector(".spinner")

}

function setError (error: Error) {
  setText('Error loading reports')
  console.log(error)
  const spinner = document.querySelector(".spinner") as HTMLElement;
  const errorBadge = document.querySelector('.error-badge') as HTMLElement;
  if (spinner && errorBadge) {
    spinner.style.display = 'none';
    errorBadge.style.display = 'block';
  }
}

function displayReports(attachmentClient: AttachmentClient) {
  const nbAttachments = attachmentClient.getAttachments().length
  if (nbAttachments) {
    ReactDOM.render(<TaskAttachmentPanel attachmentClient={attachmentClient} />, document.getElementById("postman-ext-container"))
    document.getElementById("postman-ext-message").style.display = "none"
  } else {
  setError(Error("Could not find any report attachment"))
  }
}

SDK.register("registerRelease", {
  isInvisible: function (state) {
    let resultArray = []
    state.releaseEnvironment.deployPhasesSnapshot.forEach(phase => {
      phase.workflowTasks.forEach(task => {
        resultArray.push(task.taskId)
      })
    })
    return !OUR_TASK_IDS.some(id => resultArray.includes(id))
  }
})

interface ReportProps {
  successful: boolean,
  name: string,
  href: string
}

interface ReportCardProps {
  attachmentClient: AttachmentClient,
  report: ReportProps,
}

class ReportCard extends React.Component<ReportCardProps> {
  private collapsed = new ObservableValue<boolean>(true);
  private initialContent = '<p>Loading...</p>'
  private content = new ObservableValue<string>(this.initialContent)
  private commandBarItems: IHeaderCommandBarItem[]

  constructor(props: ReportCardProps) {
    super(props);
    this.commandBarItems = [
      {
        important: true,
        id: "Download",
        text: "Download",
        href: this.props.report.href,
        iconProps: {
          iconName: "Download"
        }
      }
    ]
  }

  private escapeHTML(str: string) {
    return str.replace(/[&<>'"]/g, tag => ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          "'": '&#39;',
          '"': '&quot;'
        }[tag] || tag))
  }

  public render() {
    const metadata = this.props.report.name.split('.')
    // Extract HTML file name and maintain backward compatibility for old builds
    const reportName = (metadata.length > 2) ? `${metadata[4]}.${metadata[5]}` : this.props.report.name
    return (
      <Card
        className={"flex-grow " + (this.props.report.successful ? "card-success" : "card-failure")}
        collapsible={true}
        collapsed={this.collapsed}
        onCollapseClick={this.onCollapseClicked}
        titleProps={{ text: reportName }}
        headerIconProps={{iconName: this.props.report.successful ? 'SkypeCircleCheck' : 'StatusErrorFull'}}
        headerCommandBarItems={this.commandBarItems}>

        <Observer content={this.content}>
          {(props: { content: string }) => {
            return  <span className="full-size" dangerouslySetInnerHTML={ {__html: props.content} } />
          }}
        </Observer>
      </Card>
    )
  }

  private onCollapseClicked = () => {
    this.collapsed.value = !this.collapsed.value;
    if (this.content.value == this.initialContent) {
      this.props.attachmentClient.downloadReportContent(this.props.report.name).then(report => {
        this.content.value = '<iframe class="full-size" srcdoc="' + this.escapeHTML(report) + '"></iframe>'
      }).catch(err => {
        this.content.value = err
      })
    }
  }
}


interface TaskAttachmentPanelProps {
  attachmentClient: AttachmentClient
}

export default class TaskAttachmentPanel extends React.Component<TaskAttachmentPanelProps> {
  private selectedTabId: ObservableValue<string>
  private tabContents: ObservableObject<JSX.Element>
  private tabInitialContent: JSX.Element = <div className="wide"><p>Loading...</p></div>

  constructor(props: TaskAttachmentPanelProps) {
    super(props);
    this.selectedTabId = new ObservableValue(props.attachmentClient.getAttachments()[0].name)
    this.tabContents = new ObservableObject()
  }

  public componentDidMount() {
    // const config = SDK.getConfiguration()
    // SDK.notifyLoadSucceeded().then(() => {
    //     SDK.resize()
    // });
  }

  public render() {
    const attachments = this.props.attachmentClient.getAttachments()
    if (attachments.length == 0) {
      return (null)
    } else {
      const tabs = []
      let tabNameCount = {}
      attachments.map(attachment => attachment.name.split('.')[0]).forEach(el => tabNameCount[el] = 1  + (tabNameCount[el] || 0))
      for (const attachment of attachments) {
        const metadata = attachment.name.split('.')
        // Conditionally add counter for multistage pipeline with more than one attempt
        const name = (metadata[2] !== '__default' && tabNameCount[metadata[0]] > 1) ? `${metadata[0]} #${metadata[3]}` : metadata[0]

        tabs.push(<Tab name={name} id={attachment.name} key={attachment.name} url={attachment._links.self.href}/>)
        this.tabContents.add(attachment.name, this.tabInitialContent)
      }
      return (
        <div className="flex-column">
          { attachments.length > 1 ?
            <TabBar
              onSelectedTabChanged={this.onSelectedTabChanged}
              selectedTabId={this.selectedTabId}
              tabSize={TabSize.Tall}>
              {tabs}
            </TabBar>
          : null }
          <Observer selectedTabId={this.selectedTabId} tabContents={this.tabContents}>
            {(props: { selectedTabId: string }) => {
              if ( this.tabContents.get(props.selectedTabId) === this.tabInitialContent) {
                this.props.attachmentClient.getReportSummary(props.selectedTabId).then((summary) => {
                  const cards = []
                  for (const reportData of summary) {
                    const cardProps: ReportCardProps = {report: reportData, attachmentClient: this.props.attachmentClient}
                    cards.push(<ReportCard {...cardProps} key={reportData.name} />)
                  }
                  const content = <div className="flex-column" style={{ flexWrap: "nowrap" }}>{cards}</div>
                  this.tabContents.set(props.selectedTabId, content)
                }).catch(error => {
                  this.tabContents.set(props.selectedTabId, <div className="wide"><p>Error loading report:<br/>' + error + '</p></div>)
                  setError(error)
                })
              }
              return  this.tabContents.get(props.selectedTabId)
            }}
          </Observer>
        </div>
      );
    }
  }

  private onSelectedTabChanged = (newTabId: string) => {
    this.selectedTabId.value = newTabId;
  }
}


/**
* Abstrac AttachemntClient
*/
abstract class AttachmentClient {
  protected attachments: (Attachment  | ReleaseTaskAttachment)[] = []
  protected authHeaders: Object = undefined
  protected summaryTemplate: string = undefined
  protected appJsContent: string = undefined
  constructor() {}

  // Retrieve attachments and attachment contents from AzDO
  abstract init(): Promise<void>

  abstract downloadSummaryContent(summaryReportName:string): Promise<string>
  
  abstract downloadReportContent(reportName:string): Promise<string>

  abstract getReportAttachments(): Promise<Attachment[] | ReleaseTaskAttachment[]>

  public getAttachments() : (Attachment  | ReleaseTaskAttachment)[] {
    return this.attachments
  }

  public getDownloadableAttachment(attachmentName: string): Attachment | ReleaseTaskAttachment {
    const attachment = this.attachments.find((attachment) => { return attachment.name === attachmentName})
    if (!(attachment && attachment._links && attachment._links.self && attachment._links.self.href)) {
      throw new Error("Attachment " + attachmentName + " is not downloadable")
    }
    return attachment
  }

  public async getReportSummary(attachmentName: string): Promise<ReportProps[]> {
    setText('Looking for Summary File')
    console.log("Get " + attachmentName + " attachment content")
    const attachment = this.getDownloadableAttachment(attachmentName)
    const summaryContentJson = JSON.parse(await this.downloadSummaryContent(attachment.name))
    setText('Processing Summary File')
    const reports = await this.getReportAttachments()
    let data = summaryContentJson.map(report => {
      let rp = reports.find(x => x.name === report.name)
      return {
        successful: report.successfull,
        name: report.name,
        href: rp._links.self.href
      }
    })
    return data
  }
}

/**
* Build Attachemnts client
*/
class BuildAttachmentClient extends AttachmentClient {
  private build: Build

  private recordId:string
  private timelineId:string

  constructor(build: Build) {
    super()
    this.build = build
  }

  public async init() {
    console.log('Get attachment list')
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    this.attachments = await buildClient.getAttachments(this.build.project.id, this.build.id, ATTACHMENT_TYPE)
  }

  public async getReportAttachments(): Promise<Attachment[]> {
    console.log('Get report list')
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    return await buildClient.getAttachments(this.build.project.id, this.build.id, REPORT_ATTACHMENT_TYPE)
  }

  private async getAttachmentsContent(attachmentName: string, type: string): Promise<string> {
    console.log('Get report content' + attachmentName)
    var decoder= new TextDecoder('utf-8');
    const buildClient: BuildRestClient = getClient(BuildRestClient)
    return await buildClient.getAttachment(this.build.project.id, this.build.id, this.timelineId, this.recordId, type, attachmentName)
          .then((result)=>{
            return decoder.decode(result)
          })
          .catch((error: Error) => {
            throw new Error(error.message)
          })
  }

  public async downloadSummaryContent(name:string): Promise<string> {
    return this.getAttachmentsContent(name,ATTACHMENT_TYPE)
  }

  public async downloadReportContent(name:string): Promise<string> {
    return this.getAttachmentsContent(name,REPORT_ATTACHMENT_TYPE)
  }
}

/**
* Release Attachemnts client
*/
  class ReleaseAttachmentClient extends AttachmentClient {
    private releaseEnvironment: ReleaseEnvironment
    private projectId:string
    private deployStepAttempt:number
    private runPlanId:string
    private recordId:string
    private timelineId:string

    constructor(releaseEnvironment: ReleaseEnvironment) {
      super()
      this.releaseEnvironment = releaseEnvironment
    }

    public async init() {
      const releaseId = this.releaseEnvironment.releaseId
      const environmentId = this.releaseEnvironment.id
      console.log('Get project')
      const projectService = await SDK.getService<IProjectPageService>(CommonServiceIds.ProjectPageService)
      const project = await projectService.getProject()
      console.log('Get release')
      const releaseClient: ReleaseRestClient = getClient(ReleaseRestClient)
      const release = await releaseClient.getRelease(project.id, releaseId)
      const env = release.environments.filter((e) => e.id === environmentId)[0]

      if (!(env.deploySteps && env.deploySteps.length)) {
        throw new Error("This release has not been deployed yet")
      }

      const deployStep = env.deploySteps[env.deploySteps.length - 1]
      if (!(deployStep.releaseDeployPhases && deployStep.releaseDeployPhases.length)) {
        throw new Error("This release has no job");
      }

      const runPlanIds = deployStep.releaseDeployPhases.map((phase) => phase.runPlanId)
      if (!runPlanIds.length) {
        throw new Error("There are no plan IDs");
      } else {
        searchForRunPlanId: {
          for (const phase of deployStep.releaseDeployPhases) {
            for (const deploymentJob of phase.deploymentJobs) {
              for (const task of deploymentJob.tasks){
                if (OUR_TASK_IDS.includes(task.task?.id)) {
                  this.runPlanId = phase.runPlanId;
                  break searchForRunPlanId
                }
              }
            }
          }
        }
      }
      this.projectId = project.id
      this.deployStepAttempt = deployStep.attempt
      console.log('Get attachment list')
      const releaseAttachments= await releaseClient.getReleaseTaskAttachments(project.id, releaseId, environmentId, deployStep.attempt, this.runPlanId, ATTACHMENT_TYPE)
      this.attachments = releaseAttachments
      if (this.attachments.length === 0) {
        throw new Error("There is no attachment")
      }
      if (this.attachments.length >1) {
        throw new Error("There is more than a single attachment, this is not expected")
      }
      this.recordId=releaseAttachments[0].recordId
      this.timelineId=releaseAttachments[0].timelineId
    }

    public async getReportAttachments(): Promise<ReleaseTaskAttachment[]> {
      console.log('Get report list')
      const releaseClient: ReleaseRestClient = getClient(ReleaseRestClient)
      return await releaseClient.getReleaseTaskAttachments(this.projectId, this.releaseEnvironment.releaseId, this.releaseEnvironment.id, this.deployStepAttempt, this.runPlanId, REPORT_ATTACHMENT_TYPE)
    }

    private async getAttachmentsContent(attachmentName: string, type: string): Promise<string> {
      console.log('Get report content' + attachmentName)
      var decoder= new TextDecoder('utf-8');
      const releaseClient: ReleaseRestClient = getClient(ReleaseRestClient)
      return releaseClient.getReleaseTaskAttachmentContent(this.projectId, this.releaseEnvironment.releaseId, this.releaseEnvironment.id, this.deployStepAttempt, this.runPlanId, this.timelineId, this.recordId, type ,attachmentName)
            .then((result)=>{
              return decoder.decode(result)
            })
            .catch((error: Error) => {
              throw new Error(error.message)
            })
    }

    public async downloadSummaryContent(name:string): Promise<string> {
      return this.getAttachmentsContent(name,ATTACHMENT_TYPE)
    }

    public async downloadReportContent(name:string): Promise<string> {
      return this.getAttachmentsContent(name,REPORT_ATTACHMENT_TYPE)
    }
  }
